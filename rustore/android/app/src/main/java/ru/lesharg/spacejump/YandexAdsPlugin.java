package ru.lesharg.spacejump;

import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.yandex.mobile.ads.common.AdError;
import com.yandex.mobile.ads.common.AdRequest;
import com.yandex.mobile.ads.common.AdRequestError;
import com.yandex.mobile.ads.common.ImpressionData;
import com.yandex.mobile.ads.common.YandexAds;
import com.yandex.mobile.ads.interstitial.InterstitialAd;
import com.yandex.mobile.ads.interstitial.InterstitialAdEventListener;
import com.yandex.mobile.ads.interstitial.InterstitialAdLoadListener;
import com.yandex.mobile.ads.interstitial.InterstitialAdLoader;
import com.yandex.mobile.ads.rewarded.Reward;
import com.yandex.mobile.ads.rewarded.RewardedAd;
import com.yandex.mobile.ads.rewarded.RewardedAdEventListener;
import com.yandex.mobile.ads.rewarded.RewardedAdLoadListener;
import com.yandex.mobile.ads.rewarded.RewardedAdLoader;

/**
 * Реклама Яндекса (Yandex Mobile Ads SDK 8) для веб-части игры.
 *
 *   YandexAds.init()             → { enabled, demo }
 *   YandexAds.showInterstitial() → { shown }
 *   YandexAds.showRewarded()     → { shown, rewarded }
 *
 * Блоки — из rustore/app.config.json (app/build.gradle кладёт их в BuildConfig).
 * Если блоки пустые: в отладочной сборке — демо-блоки Яндекса, в релизной
 * реклама выключена и SDK даже не запускается.
 *
 * Объявления загружаются заранее и снова после каждого показа, чтобы по
 * кнопке реклама открывалась сразу. Не успела загрузиться — игра получает
 * { shown: false } и пишет «Реклама недоступна».
 *
 * Всё, что касается SDK, выполняется в главном потоке.
 */
@CapacitorPlugin(name = "YandexAds")
public class YandexAdsPlugin extends Plugin {

    private static final String TAG = "YandexAds";
    private static final String DEMO_INTERSTITIAL = "demo-interstitial-yandex";
    private static final String DEMO_REWARDED = "demo-rewarded-yandex";
    private static final long RETRY_MIN_MS = 15_000;
    private static final long RETRY_MAX_MS = 300_000;

    private final Handler main = new Handler(Looper.getMainLooper());

    private String interstitialId = "";
    private String rewardedId = "";
    private boolean demo;
    private boolean started;
    private boolean showing;

    private InterstitialAdLoader interstitialLoader;
    private InterstitialAd interstitial;
    private boolean interstitialLoading;
    private long interstitialRetry = RETRY_MIN_MS;

    private RewardedAdLoader rewardedLoader;
    private RewardedAd rewarded;
    private boolean rewardedLoading;
    private long rewardedRetry = RETRY_MIN_MS;

    @Override
    public void load() {
        String i = BuildConfig.YANDEX_INTERSTITIAL_ID.trim();
        String r = BuildConfig.YANDEX_REWARDED_ID.trim();
        demo = BuildConfig.DEBUG && i.isEmpty() && r.isEmpty();
        interstitialId = demo ? DEMO_INTERSTITIAL : i;
        rewardedId = demo ? DEMO_REWARDED : r;
    }

    private boolean enabled() {
        return !interstitialId.isEmpty() || !rewardedId.isEmpty();
    }

    /* ─── JS ─────────────────────────────────── */

    @PluginMethod
    public void init(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("enabled", enabled());
        ret.put("demo", demo);
        call.resolve(ret);
        if (enabled()) main.post(this::start);
    }

    @PluginMethod
    public void showInterstitial(PluginCall call) {
        main.post(() -> {
            if (interstitial == null || showing || getActivity() == null) {
                resolveShown(call, false, false);
                loadInterstitial();
                return;
            }
            final InterstitialAd ad = interstitial;
            interstitial = null;
            showing = true;
            final boolean[] shown = { false };
            final boolean[] done = { false };
            ad.setAdEventListener(new InterstitialAdEventListener() {
                @Override public void onAdShown() { shown[0] = true; }
                @Override public void onAdFailedToShow(AdError error) {
                    Log.w(TAG, "interstitial: show failed: " + error.getDescription());
                    finish();
                }
                @Override public void onAdDismissed() { finish(); }
                @Override public void onAdClicked() {}
                @Override public void onAdImpression(ImpressionData data) {}

                private void finish() {
                    if (done[0]) return;
                    done[0] = true;
                    showing = false;
                    resolveShown(call, shown[0], false);
                    loadInterstitial();
                }
            });
            ad.show(getActivity());
        });
    }

    @PluginMethod
    public void showRewarded(PluginCall call) {
        main.post(() -> {
            if (rewarded == null || showing || getActivity() == null) {
                resolveShown(call, false, false);
                loadRewarded();
                return;
            }
            final RewardedAd ad = rewarded;
            rewarded = null;
            showing = true;
            final boolean[] shown = { false };
            final boolean[] earned = { false };
            final boolean[] done = { false };
            ad.setAdEventListener(new RewardedAdEventListener() {
                @Override public void onAdShown() { shown[0] = true; }
                @Override public void onAdFailedToShow(AdError error) {
                    Log.w(TAG, "rewarded: show failed: " + error.getDescription());
                    finish();
                }
                @Override public void onAdDismissed() { finish(); }
                @Override public void onAdClicked() {}
                @Override public void onAdImpression(ImpressionData data) {}
                @Override public void onRewarded(Reward reward) { earned[0] = true; }

                private void finish() {
                    if (done[0]) return;
                    done[0] = true;
                    showing = false;
                    resolveShown(call, shown[0], earned[0]);
                    loadRewarded();
                }
            });
            ad.show(getActivity());
        });
    }

    private static void resolveShown(PluginCall call, boolean shown, boolean rewarded) {
        JSObject ret = new JSObject();
        ret.put("shown", shown);
        ret.put("rewarded", rewarded);
        call.resolve(ret);
    }

    /* ─── SDK ────────────────────────────────── */

    private void start() {
        if (started) return;
        started = true;
        // Настройки — до инициализации: игра 0+, реклама без персонализации (п. 9.7 правил RuStore)
        YandexAds.setAgeRestricted(BuildConfig.YANDEX_AGE_RESTRICTED);
        YandexAds.setLocationTracking(false);
        if (BuildConfig.DEBUG) YandexAds.enableLogging(true);
        YandexAds.initialize(getContext(), () -> main.post(() -> {
            Log.i(TAG, "SDK " + YandexAds.getLibraryVersion() + " ready" + (demo ? " (demo ad units)" : ""));
            loadInterstitial();
            loadRewarded();
        }));
    }

    private AdRequest request(String unitId) {
        return new AdRequest.Builder(unitId).build();
    }

    private void loadInterstitial() {
        if (!started || interstitialId.isEmpty() || interstitial != null || interstitialLoading) return;
        interstitialLoading = true;
        if (interstitialLoader == null) interstitialLoader = new InterstitialAdLoader(getContext());
        interstitialLoader.loadAd(request(interstitialId), new InterstitialAdLoadListener() {
            @Override public void onAdLoaded(InterstitialAd ad) {
                interstitialLoading = false;
                interstitialRetry = RETRY_MIN_MS;
                interstitial = ad;
            }
            @Override public void onAdFailedToLoad(AdRequestError error) {
                interstitialLoading = false;
                Log.w(TAG, "interstitial: " + error.getCode() + " " + error.getDescription());
                main.postDelayed(YandexAdsPlugin.this::loadInterstitial, interstitialRetry);
                interstitialRetry = Math.min(interstitialRetry * 2, RETRY_MAX_MS);
            }
        });
    }

    private void loadRewarded() {
        if (!started || rewardedId.isEmpty() || rewarded != null || rewardedLoading) return;
        rewardedLoading = true;
        if (rewardedLoader == null) rewardedLoader = new RewardedAdLoader(getContext());
        rewardedLoader.loadAd(request(rewardedId), new RewardedAdLoadListener() {
            @Override public void onAdLoaded(RewardedAd ad) {
                rewardedLoading = false;
                rewardedRetry = RETRY_MIN_MS;
                rewarded = ad;
            }
            @Override public void onAdFailedToLoad(AdRequestError error) {
                rewardedLoading = false;
                Log.w(TAG, "rewarded: " + error.getCode() + " " + error.getDescription());
                main.postDelayed(YandexAdsPlugin.this::loadRewarded, rewardedRetry);
                rewardedRetry = Math.min(rewardedRetry * 2, RETRY_MAX_MS);
            }
        });
    }

    @Override
    protected void handleOnDestroy() {
        main.removeCallbacksAndMessages(null);
        if (interstitialLoader != null) interstitialLoader.cancelLoading();
        if (rewardedLoader != null) rewardedLoader.cancelLoading();
        super.handleOnDestroy();
    }
}
