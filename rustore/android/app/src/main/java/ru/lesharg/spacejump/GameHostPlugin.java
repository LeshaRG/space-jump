package ru.lesharg.spacejump;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.view.HapticFeedbackConstants;
import android.view.View;
import android.view.WindowManager;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * То, чего нет у браузера, для веб-части игры (rustore/src/platform.js):
 *
 *   GameHost.haptic({ kind: "tick" | "heavy" | "confirm" })  — отклик на удар, приземление, рекорд;
 *   GameHost.keepScreenOn({ on })                              — экран не гаснет во время забега;
 *   GameHost.openUrl({ url })                                  — ссылка во внешнем браузере / почте.
 *
 * Вибрация идёт через performHapticFeedback: она не требует разрешения
 * VIBRATE и сама выключается, если в настройках Android выключен
 * тактильный отклик.
 */
@CapacitorPlugin(name = "GameHost")
public class GameHostPlugin extends Plugin {

    @PluginMethod
    public void haptic(PluginCall call) {
        String kind = call.getString("kind", "tick");
        final int effect;
        if ("heavy".equals(kind)) {
            effect = HapticFeedbackConstants.LONG_PRESS;
        } else if ("confirm".equals(kind)) {
            effect = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R
                ? HapticFeedbackConstants.CONFIRM
                : HapticFeedbackConstants.VIRTUAL_KEY;
        } else {
            effect = HapticFeedbackConstants.CLOCK_TICK;
        }
        getActivity().runOnUiThread(() -> {
            View web = getBridge().getWebView();
            if (web != null) web.performHapticFeedback(effect);
        });
        call.resolve();
    }

    @PluginMethod
    public void keepScreenOn(PluginCall call) {
        final boolean on = Boolean.TRUE.equals(call.getBoolean("on", false));
        getActivity().runOnUiThread(() -> {
            if (on) getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            else getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        });
        call.resolve();
    }

    @PluginMethod
    public void openUrl(PluginCall call) {
        String url = call.getString("url", "");
        if (!(url.startsWith("https://") || url.startsWith("http://") || url.startsWith("mailto:"))) {
            call.reject("unsupported url");
            return;
        }
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (ActivityNotFoundException e) {
            call.reject("no app to open url");
        }
    }
}
