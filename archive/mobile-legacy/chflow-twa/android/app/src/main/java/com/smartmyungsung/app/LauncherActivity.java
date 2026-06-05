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
            startActivity(android.content.Intent.createChooser(
                new android.content.Intent(android.content.Intent.ACTION_VIEW, LAUNCH_URI),
                null
            ));
            finish();
            return;
        }

        boolean bound = CustomTabsClient.bindCustomTabsService(this, packageName, new CustomTabsServiceConnection() {
            @Override
            public void onCustomTabsServiceConnected(ComponentName name, CustomTabsClient client) {
                CustomTabsSession session = client.newSession(null);
                if (session == null) {
                    launchFallback(packageName);
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

        if (!bound) {
            launchFallback(packageName);
        }
    }

    private void launchFallback(String packageName) {
        CustomTabsIntent intent = new CustomTabsIntent.Builder().build();
        intent.intent.setPackage(packageName);
        intent.launchUrl(this, LAUNCH_URI);
        finish();
    }
}
