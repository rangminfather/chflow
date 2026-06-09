import { StatusBar } from 'expo-status-bar';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  BackHandler,
  Platform,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView, WebViewMessageEvent, WebViewNavigation } from 'react-native-webview';

const TARGET_URL = 'https://chflow-app.vercel.app';

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
      var client = window.__chflowSupabase;
      if (!client || !client.auth || !client.auth.getSession) return;
      var result = await client.auth.getSession();
      var token = result && result.data && result.data.session && result.data.session.access_token;
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

function AppWebView() {
  const webViewRef = useRef<WebView>(null);
  const [canGoBack, setCanGoBack] = useState(false);
  const [expoPushToken, setExpoPushToken] = useState<string | null>(null);
  const pendingAccessTokenRef = useRef<string | null>(null);
  const registeredKeyRef = useRef<string | null>(null);
  const safeAreaPadding = useSafeAreaPadding();

  useEffect(() => {
    registerForPushNotifications().then(setExpoPushToken).catch(() => setExpoPushToken(null));
  }, []);

  // Android 물리 뒤로가기 버튼 처리
  useEffect(() => {
    if (Platform.OS !== 'android') return;

    const onBackPress = () => {
      if (canGoBack) {
        // WebView 내부에 뒤로갈 페이지가 있으면 그걸 먼저
        webViewRef.current?.goBack();
        return true;
      }
      // 더 이상 뒤로갈 페이지가 없으면 종료 확인
      Alert.alert(
        '스마트명성',
        '앱을 종료하시겠습니까?',
        [
          { text: '취소', style: 'cancel' },
          {
            text: '종료',
            style: 'destructive',
            onPress: () => BackHandler.exitApp(),
          },
        ],
        { cancelable: true }
      );
      return true; // 기본 동작 차단
    };

    const sub = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => sub.remove();
  }, [canGoBack]);

  const handleNavStateChange = (nav: WebViewNavigation) => {
    setCanGoBack(nav.canGoBack);
  };

  const registerPushToken = async (accessToken: string, token: string) => {
    const registerKey = `${accessToken.slice(-12)}:${token}`;
    if (registeredKeyRef.current === registerKey) return;

    const response = await fetch(`${TARGET_URL}/api/mobile/push-token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        expoPushToken: token,
        platform: Platform.OS,
        deviceId: Constants.sessionId || null,
        appId: 'smart-myungsung',
      }),
    });

    if (response.ok) {
      registeredKeyRef.current = registerKey;
    }
  };

  useEffect(() => {
    if (!expoPushToken || !pendingAccessTokenRef.current) return;
    registerPushToken(pendingAccessTokenRef.current, expoPushToken).catch(() => {});
  }, [expoPushToken]);

  const handleWebViewMessage = (event: WebViewMessageEvent) => {
    let message: { type?: string; accessToken?: string };
    try {
      message = JSON.parse(event.nativeEvent.data);
    } catch {
      return;
    }

    if (message.type !== 'CHFLOW_AUTH_TOKEN' || !message.accessToken) return;
    pendingAccessTokenRef.current = message.accessToken;
    if (expoPushToken) {
      registerPushToken(message.accessToken, expoPushToken).catch(() => {});
    }
  };

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
          onLoadEnd={() => webViewRef.current?.injectJavaScript(SESSION_BRIDGE_SCRIPT)}
          // 쿠키/세션 유지 (로그인 지속)
          sharedCookiesEnabled={true}
          thirdPartyCookiesEnabled={true}
          // 로컬스토리지/IndexedDB 활성화
          domStorageEnabled={true}
          // JS 필수
          javaScriptEnabled={true}
          // 파일 업로드 허용 (프로필 사진 등)
          allowsInlineMediaPlayback={true}
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
          applicationNameForUserAgent="SmartMyungsungApp/1.0"
          style={styles.webview}
        />
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
});
