package com.smartmyungsung.app;

import android.content.ComponentName;
import android.net.Uri;
import android.os.Bundle;
import androidx.browser.customtabs.CustomTabsClient;
import androidx.browser.customtabs.CustomTabsIntent;
import androidx.browser.customtabs.CustomTabsServiceConnection;
import androidx.browser.customtabs.CustomTabsSession;
import androidx.browser.trusted.TrustedWebActivityIntentBuilder;

public class LauncherActivity extends android.app.Activity {

    private static final Uri LAUNCH_URI = Uri.parse("https://chflow-app.vercel.app");

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        String packageName = CustomTabsClient.getPackageName(this, null);
        if (packageName == null) {
            // No Custom Tabs provider, fall back to browser
            startActivity(new android.content.Intent(android.content.Intent.ACTION_VIEW, LAUNCH_URI));
            finish();
            return;
        }

        CustomTabsClient.bindCustomTabsService(this, packageName, new CustomTabsServiceConnection() {
            @Override
            public void onCustomTabsServiceConnected(ComponentName name, CustomTabsClient client) {
                CustomTabsSession session = client.newSession(null);
                if (session == null) {
                    launchFallback();
                    return;
                }
                new TrustedWebActivityIntentBuilder(LAUNCH_URI)
                    .build(session)
                    .launchTrustedWebActivity(LauncherActivity.this);
                finish();
            }

            @Override
            public void onServiceDisconnected(ComponentName name) {}
        });
    }

    private void launchFallback() {
        new CustomTabsIntent.Builder()
            .build()
            .launchUrl(this, LAUNCH_URI);
        finish();
    }
}
