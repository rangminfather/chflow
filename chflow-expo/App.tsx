import { StatusBar } from 'expo-status-bar';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import * as Application from 'expo-application';
import * as SecureStore from 'expo-secure-store';
import * as ScreenOrientation from 'expo-screen-orientation';
import { maybeConfirmAttendance, stopAttendanceGeofence, syncAttendanceGeofence } from './attendanceGeofence';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  AppState,
  BackHandler,
  Linking,
  Platform,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView, WebViewMessageEvent, WebViewNavigation } from 'react-native-webview';

const TARGET_URL = 'https://chflow-app.vercel.app';
const TARGET_ORIGIN = new URL(TARGET_URL).origin;
const ATTENDANCE_DISCLOSURE_KEY = 'chflow.attendance-disclosure-accepted.v2';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

const SESSION_BRIDGE_SCRIPT = `
(function () {
  if (window.__SMARTMS_NATIVE_SESSION_BRIDGE__) return true;
  window.__SMARTMS_NATIVE_SESSION_BRIDGE__ = true;

  async function sendSessionToken() {
    try {
      var getter = window.__chflowGetToken;
      if (typeof getter !== 'function') return;
      var token = await getter();
      if (token && window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'CHFLOW_AUTH_TOKEN',
          accessToken: token
        }));
      }
    } catch (e) {}
  }

  setTimeout(sendSessionToken, 800);
  setTimeout(sendSessionToken, 2500);
  setInterval(sendSessionToken, 15000);
  return true;
})();
`;

export default function App() {
  return (
    <SafeAreaProvider>
      <AppWebView />
    </SafeAreaProvider>
  );
}

function ForceUpdateScreen({ storeUrl }: { storeUrl: string }) {
  const open = () => {
    Linking.openURL(storeUrl).catch(() =>
      Linking.openURL('https://play.google.com/store/apps/details?id=com.smartmyungsung.app')
    );
  };
  return (
    <View style={styles.updateContainer}>
      <Text style={styles.updateTitle}>업데이트 필요</Text>
      <Text style={styles.updateBody}>
        원활한 서비스 이용을 위해{'\n'}최신 버전으로 업데이트해 주세요.
      </Text>
      <TouchableOpacity style={styles.updateButton} onPress={open}>
        <Text style={styles.updateButtonText}>Play Store에서 업데이트</Text>
      </TouchableOpacity>
    </View>
  );
}

function AppWebView() {
  const webViewRef = useRef<WebView>(null);
  const [canGoBack, setCanGoBack] = useState(false);
  const [expoPushToken, setExpoPushToken] = useState<string | null>(null);
  const [needsUpdate, setNeedsUpdate] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updateDismissed, setUpdateDismissed] = useState(false);
  const [storeUrl, setStoreUrl] = useState('market://details?id=com.smartmyungsung.app');
  const pendingAccessTokenRef = useRef<string | null>(null);
  const attendanceDisclosureShownRef = useRef(false);
  const registeredKeyRef = useRef<string | null>(null);
  const pendingNotificationUrlRef = useRef<string | null>(null);
  const webViewReadyRef = useRef(false);
  const exitedRef = useRef(false);
  // 종료 후 재실행 시 마지막 화면이 잠깐 보이는 것을 가리는 덮개
  const [exitReloading, setExitReloading] = useState(false);
  const safeAreaPadding = useSafeAreaPadding();

  useEffect(() => {
    registerForPushNotifications().then(setExpoPushToken).catch(() => setExpoPushToken(null));
  }, []);

  useEffect(() => {
    // Android Play versionCode is not comparable to the iOS TestFlight build number.
    // Keep the Android update banner out of iOS until a separate iOS rollout policy exists.
    if (Platform.OS !== 'android') return;

    const check = async () => {
      try {
        const res = await fetch(`${TARGET_URL}/api/app-config`);
        if (!res.ok) return;
        const config = await res.json() as {
          min_android_build: number;
          latest_android_build?: number;
          play_store_url: string;
        };
        const build = parseInt(Application.nativeBuildVersion ?? '0', 10);
        if (config.play_store_url) setStoreUrl(config.play_store_url);
        if (build <= 0) return;
        if (build < config.min_android_build) {
          // 치명적: 차단형 강제 업데이트
          setNeedsUpdate(true);
        } else if (config.latest_android_build && build < config.latest_android_build) {
          // 일반 신규 버전: 닫기 가능한 권장 업데이트 안내
          setUpdateAvailable(true);
        }
      } catch {
        // 실패 시 앱 사용 허용 (fail open)
      }
    };
    check();
  }, []);

  // 종료 확인 모달 (웹이 '루트에서 뒤로가기' 신호를 보낼 때 호출)
  const promptExit = useCallback(() => {
    Alert.alert(
      '스마트명성',
      '앱을 종료하시겠습니까?',
      [
        { text: '취소', style: 'cancel' },
        {
          text: '종료',
          style: 'destructive',
          onPress: () => {
            // exitApp()은 프로세스를 죽이지 않고 태스크만 백그라운드로 보냄.
            // 다음 포그라운드 진입 시 스플래시(/)부터 다시 시작하도록 표시.
            exitedRef.current = true;
            BackHandler.exitApp();
          },
        },
      ],
      { cancelable: true }
    );
  }, []);

  // Android 물리 뒤로가기 → 웹에 위임.
  // WebView의 canGoBack은 Next.js SPA(pushState)를 제대로 추적하지 못하므로,
  // 웹의 실제 history로 뒤로가기를 처리하고, 루트(홈)에서만 종료를 확인한다.
  useEffect(() => {
    if (Platform.OS !== 'android') return;

    const BACK_DELEGATE_JS = `
      (function(){
        try {
          if (typeof window.__chflowHardwareBack === 'function') { window.__chflowHardwareBack(); }
          else if (window.history.length > 1) { window.history.back(); }
          else if (window.ReactNativeWebView) { window.ReactNativeWebView.postMessage(JSON.stringify({type:'CHFLOW_BACK_AT_ROOT'})); }
        } catch (e) {}
      })(); true;
    `;

    const onBackPress = () => {
      webViewRef.current?.injectJavaScript(BACK_DELEGATE_JS);
      return true; // 기본 동작(즉시 종료) 항상 차단, 처리는 웹/메시지로
    };

    const sub = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => sub.remove();
  }, []);

  // '종료'로 나갔다가 다시 실행하면 스플래시(/)부터 시작 (런치 모션 재생)
  // 덮개(exitReloading)로 마지막 화면을 가려서 "옛 화면 → 민들레" 깜빡임 방지
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && pendingAccessTokenRef.current) {
        maybeConfirmAttendance(pendingAccessTokenRef.current).catch(() => {});
      }
      if (state === 'active' && exitedRef.current) {
        exitedRef.current = false;
        setExitReloading(true);
        webViewRef.current?.injectJavaScript(
          `window.location.replace(${JSON.stringify(TARGET_URL + '/')}); true;`
        );
      }
    });
    return () => sub.remove();
  }, []);

  // 덮개 안전장치: 로드가 끝나지 않아도 4초 후엔 걷어냄
  useEffect(() => {
    if (!exitReloading) return;
    const timer = setTimeout(() => setExitReloading(false), 4000);
    return () => clearTimeout(timer);
  }, [exitReloading]);

  const handleNavStateChange = (nav: WebViewNavigation) => {
    setCanGoBack(nav.canGoBack);
  };

  const loadUrlInWebView = useCallback((url: string) => {
    const targetUrl = normalizeNotificationUrl(url);
    if (!targetUrl) return;

    if (!webViewReadyRef.current || !webViewRef.current) {
      pendingNotificationUrlRef.current = targetUrl;
      return;
    }

    webViewRef.current.injectJavaScript(
      `window.location.href = ${JSON.stringify(targetUrl)}; true;`
    );
    pendingNotificationUrlRef.current = null;
  }, []);

  const flushPendingNotificationUrl = useCallback(() => {
    const pendingUrl = pendingNotificationUrlRef.current;
    if (!pendingUrl) return;
    loadUrlInWebView(pendingUrl);
  }, [loadUrlInWebView]);

  const registerPushToken = async (accessToken: string, token: string) => {
    const registerKey = `${accessToken.slice(-12)}:${token}`;
    if (registeredKeyRef.current === registerKey) return;
    const deviceId = await getStableDeviceId();

    const response = await fetch(`${TARGET_URL}/api/mobile/push-token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        expoPushToken: token,
        platform: Platform.OS,
        deviceId,
        appId: 'smart-myungsung',
      }),
    });

    if (response.ok) {
      registeredKeyRef.current = registerKey;
    }
  };

  const unregisterPushToken = async () => {
    const accessToken = pendingAccessTokenRef.current;
    if (!accessToken || !expoPushToken) return;
    const deviceId = await getStableDeviceId();

    await fetch(`${TARGET_URL}/api/mobile/push-token`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        expoPushToken,
        platform: Platform.OS,
        deviceId,
        appId: 'smart-myungsung',
      }),
    });
  };

  useEffect(() => {
    if (!expoPushToken || !pendingAccessTokenRef.current) return;
    registerPushToken(pendingAccessTokenRef.current, expoPushToken).catch(() => {});
  }, [expoPushToken]);

  useEffect(() => {
    let mounted = true;

    Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (!mounted || !response) return;
        const linkUrl = getNotificationLinkUrl(response);
        if (linkUrl) loadUrlInWebView(linkUrl);
        Notifications.clearLastNotificationResponseAsync().catch(() => {});
      })
      .catch(() => {});

    const responseSub = Notifications.addNotificationResponseReceivedListener((response) => {
      const linkUrl = getNotificationLinkUrl(response);
      if (linkUrl) loadUrlInWebView(linkUrl);
    });

    const receivedSub = Notifications.addNotificationReceivedListener((notification) => {
      const badgeCount = getNotificationBadgeCount(notification);
      if (badgeCount !== null) {
        Notifications.setBadgeCountAsync(badgeCount).catch(() => {});
      }
    });

    return () => {
      mounted = false;
      responseSub.remove();
      receivedSub.remove();
    };
  }, [loadUrlInWebView]);

  const handleWebViewMessage = (event: WebViewMessageEvent) => {
    let message: { type?: string; accessToken?: string; text?: string; count?: unknown };
    try {
      message = JSON.parse(event.nativeEvent.data);
    } catch {
      return;
    }

    // Keep the native launcher badge aligned with the web notification state.
    if (message.type === 'CHFLOW_SET_BADGE') {
      const rawCount = typeof message.count === 'number'
        ? message.count
        : Number(message.count);
      if (Number.isFinite(rawCount) && rawCount >= 0) {
        const badgeCount = Math.min(Math.floor(rawCount), 9999);
        Notifications.setBadgeCountAsync(badgeCount).catch(() => {});
      }
      return;
    }

    if (message.type === 'CHFLOW_LOCK_LANDSCAPE') {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => {});
      return;
    }

    if (message.type === 'CHFLOW_UNLOCK_ORIENTATION') {
      ScreenOrientation.unlockAsync().catch(() => {});
      return;
    }

    // 웹의 '공유하기' → 네이티브 공유 시트 (카카오톡 등 선택)
    if (message.type === 'CHFLOW_SHARE_TEXT') {
      if (typeof message.text === 'string' && message.text.trim()) {
        Share.share({ message: message.text }).catch(() => {});
      }
      return;
    }

    // 웹 종료 모달의 '종료' 버튼 → 즉시 종료 (재실행 시 스플래시부터)
    if (message.type === 'CHFLOW_EXIT_APP') {
      exitedRef.current = true;
      BackHandler.exitApp();
      return;
    }

    // 웹이 '루트(홈)에서 뒤로가기' 라고 알려줌 → 종료 확인
    if (message.type === 'CHFLOW_BACK_AT_ROOT') {
      promptExit();
      return;
    }

    if (message.type === 'CHFLOW_SIGN_OUT') {
      unregisterPushToken().catch(() => {});
      stopAttendanceGeofence().catch(() => {});
      pendingAccessTokenRef.current = null;
      attendanceDisclosureShownRef.current = false;
      registeredKeyRef.current = null;
      Notifications.setBadgeCountAsync(0).catch(() => {});
      return;
    }

    if (message.type !== 'CHFLOW_AUTH_TOKEN' || !message.accessToken) return;
    pendingAccessTokenRef.current = message.accessToken;
    if (!attendanceDisclosureShownRef.current) {
      attendanceDisclosureShownRef.current = true;
      SecureStore.getItemAsync(ATTENDANCE_DISCLOSURE_KEY).then((accepted) => {
        if (accepted === 'accepted') return;
        Alert.alert(
          '위치정보 수집·사용 안내',
          '스마트명성은 자동출석 후보를 생성하고 출석 여부를 확인하기 위해 앱이 닫혀 있거나 사용 중이 아닐 때에도 기기의 정확한 위치정보를 수집·사용합니다.\n\n위치정보는 교회 반경 진입과 체류 여부를 확인하는 자동출석 기능에만 사용됩니다. 원시 GPS 좌표는 기기 안에서만 처리하며 서버로 전송하거나 저장하지 않습니다. 광고에 사용하거나 판매하지 않습니다.\n\n동의하지 않아도 자동출석 외의 기능은 계속 이용할 수 있습니다.',
          [
            { text: '동의 안 함', style: 'cancel' },
            {
              text: '동의하고 계속',
              onPress: () => {
                SecureStore.setItemAsync(ATTENDANCE_DISCLOSURE_KEY, 'accepted').catch(() => {});
                syncAttendanceGeofence(message.accessToken!).catch(() => {});
              },
            },
          ],
        );
      }).catch(() => {});
    }
    if (expoPushToken) {
      registerPushToken(message.accessToken, expoPushToken).catch(() => {});
    }
  };

  const handleWebViewLoadEnd = () => {
    webViewReadyRef.current = true;
    setExitReloading(false);
    webViewRef.current?.injectJavaScript(SESSION_BRIDGE_SCRIPT);
    flushPendingNotificationUrl();
  };

  if (needsUpdate) {
    return (
      <View style={styles.safe}>
        <StatusBar style="dark" backgroundColor="#FBF8F1" translucent={false} />
        <ForceUpdateScreen storeUrl={storeUrl} />
      </View>
    );
  }

  return (
    <View style={styles.safe}>
      <StatusBar style="dark" backgroundColor="#FBF8F1" translucent={false} />
      <View style={[styles.container, safeAreaPadding]}>
        <WebView
          ref={webViewRef}
          source={{ uri: TARGET_URL }}
          onNavigationStateChange={handleNavStateChange}
          onMessage={handleWebViewMessage}
          injectedJavaScript={SESSION_BRIDGE_SCRIPT}
          onLoadEnd={handleWebViewLoadEnd}
          // 쿠키/세션 유지 (로그인 지속)
          sharedCookiesEnabled={true}
          thirdPartyCookiesEnabled={true}
          // 로컬스토리지/IndexedDB 활성화
          domStorageEnabled={true}
          // JS 필수
          javaScriptEnabled={true}
          // 파일 업로드 허용 (프로필 사진 등)
          allowsInlineMediaPlayback={true}
          allowsFullscreenVideo={true}
          mediaPlaybackRequiresUserAction={false}
          // 줌 비활성 (모바일 웹에서 의도치 않은 확대 방지)
          scalesPageToFit={false}
          // 당겨서 새로고침 허용 (Android)
          pullToRefreshEnabled={true}
          // 오프라인 에러 핸들링
          renderError={() => (
            <View style={styles.errorBox} />
          )}
          // User-Agent에 앱 식별자 추가 (웹에서 네이티브 앱 여부 구분 가능)
          applicationNameForUserAgent="SmartMyungsungApp/1.1"
          style={styles.webview}
        />
        {exitReloading && <View style={styles.exitOverlay} pointerEvents="none" />}
        {updateAvailable && !updateDismissed && (
          <View style={[styles.updateBanner, { top: safeAreaPadding.paddingTop + 12 }]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.updateBannerTitle}>새 버전이 있습니다</Text>
              <Text style={styles.updateBannerBody}>더 나은 사용을 위해 업데이트해 주세요.</Text>
            </View>
            <TouchableOpacity
              style={styles.updateBannerBtn}
              onPress={() => {
                Linking.openURL(storeUrl).catch(() =>
                  Linking.openURL('https://play.google.com/store/apps/details?id=com.smartmyungsung.app')
                );
              }}
            >
              <Text style={styles.updateBannerBtnText}>업데이트</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.updateBannerClose} onPress={() => setUpdateDismissed(true)}>
              <Text style={styles.updateBannerCloseText}>✕</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </View>
  );
}

async function registerForPushNotifications(): Promise<string | null> {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') return null;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: '스마트명성 알림',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#f97316',
    });
  }

  const current = await Notifications.getPermissionsAsync();
  let finalStatus = current.status;
  if (current.status !== 'granted') {
    const requested = await Notifications.requestPermissionsAsync();
    finalStatus = requested.status;
  }
  if (finalStatus !== 'granted') return null;

  const constants = Constants as typeof Constants & {
    easConfig?: { projectId?: string };
  };
  const projectId =
    constants.expoConfig?.extra?.eas?.projectId ||
    constants.easConfig?.projectId;

  if (!projectId) return null;

  const token = await Notifications.getExpoPushTokenAsync({ projectId });
  return token.data;
}

async function getStableDeviceId(): Promise<string | null> {
  try {
    if (Platform.OS === 'android') {
      return Application.getAndroidId();
    }
    if (Platform.OS === 'ios') {
      return await Application.getIosIdForVendorAsync();
    }
  } catch {
    return null;
  }
  return null;
}

type NotificationData = {
  linkUrl?: unknown;
  link_url?: unknown;
  badge?: unknown;
};

type NotificationContentWithBadge = {
  badge?: number | null;
  data?: NotificationData;
};

function getNotificationLinkUrl(response: Notifications.NotificationResponse): string | null {
  const data = response.notification.request.content.data as NotificationData;
  const rawLink = data?.linkUrl ?? data?.link_url;
  return typeof rawLink === 'string' ? rawLink : null;
}

function getNotificationBadgeCount(notification: Notifications.Notification): number | null {
  const content = notification.request.content as NotificationContentWithBadge;
  const rawBadge = content.badge ?? content.data?.badge;
  const count = typeof rawBadge === 'number' ? rawBadge : Number(rawBadge);
  return Number.isFinite(count) && count >= 0 ? count : null;
}

function normalizeNotificationUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('/')) {
    return `${TARGET_ORIGIN}${trimmed}`;
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.origin !== TARGET_ORIGIN) return null;
    return parsed.href;
  } catch {
    return null;
  }
}

function useSafeAreaPadding() {
  const insets = useSafeAreaInsets();
  return {
    paddingTop: insets.top,
    paddingBottom: insets.bottom,
  };
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#FBF8F1',
  },
  container: {
    flex: 1,
    backgroundColor: '#f1f5f9',
  },
  webview: {
    flex: 1,
    backgroundColor: '#f1f5f9',
  },
  errorBox: {
    flex: 1,
    backgroundColor: '#f1f5f9',
  },
  exitOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#FBF8F1',
  },
  updateContainer: {
    flex: 1,
    backgroundColor: '#FBF8F1',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  updateTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#1a1a1a',
    marginBottom: 12,
  },
  updateBody: {
    fontSize: 15,
    color: '#666',
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 32,
  },
  updateButton: {
    backgroundColor: '#4A7C5F',
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 12,
  },
  updateButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  updateBanner: {
    position: 'absolute',
    left: 12,
    right: 12,
    // 컨테이너가 Safe Area 상단 여백을 이미 적용하므로, 펀치홀·상태바 아래에 표시된다.
    top: 12,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2B4539',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    gap: 10,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  updateBannerTitle: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  updateBannerBody: {
    color: '#D7E3DC',
    fontSize: 12,
    marginTop: 2,
  },
  updateBannerBtn: {
    backgroundColor: '#fff',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 9,
  },
  updateBannerBtnText: {
    color: '#2B4539',
    fontSize: 13,
    fontWeight: '700',
  },
  updateBannerClose: {
    paddingHorizontal: 6,
    paddingVertical: 6,
  },
  updateBannerCloseText: {
    color: '#A9BDB2',
    fontSize: 14,
    fontWeight: '700',
  },
});
