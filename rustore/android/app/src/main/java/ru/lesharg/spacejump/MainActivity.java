package ru.lesharg.spacejump;

import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

/**
 * Игра на весь экран: панели Android скрыты (появляются свайпом от края
 * и прячутся сами), а WebView отодвинут от выреза камеры — иначе счёт и
 * кнопка паузы ушли бы под «чёлку». Полоса под вырезом — цвет фона игры.
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(YandexAdsPlugin.class);
        registerPlugin(GameHostPlugin.class);
        super.onCreate(savedInstanceState);

        if (getBridge() == null) return;   // нет WebView на устройстве — Capacitor покажет свой экран
        View web = getBridge().getWebView();
        ViewCompat.setOnApplyWindowInsetsListener(web, (v, insets) -> {
            Insets cut = insets.getInsets(WindowInsetsCompat.Type.displayCutout());
            ViewGroup.MarginLayoutParams lp = (ViewGroup.MarginLayoutParams) v.getLayoutParams();
            if (lp.leftMargin != cut.left || lp.topMargin != cut.top
                    || lp.rightMargin != cut.right || lp.bottomMargin != cut.bottom) {
                lp.setMargins(cut.left, cut.top, cut.right, cut.bottom);
                v.setLayoutParams(lp);
            }
            return WindowInsetsCompat.CONSUMED;
        });
        hideSystemBars();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemBars();   // после рекламы, шторки уведомлений, сворачивания
    }

    private void hideSystemBars() {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        WindowInsetsControllerCompat bars = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        bars.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        bars.hide(WindowInsetsCompat.Type.systemBars());
    }
}
