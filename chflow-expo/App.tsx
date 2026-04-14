import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  BackHandler,
  Platform,
  SafeAreaView,
  StyleSheet,
  View,
} from 'react-native';
import { WebView, WebViewNavigation } from 'react-native-webview';

const TARGET_URL = 'https://chflow-app.vercel.app';

export default function App() {
  const webViewRef = useRef<WebView>(null);
  const [canGoBack, setCanGoBack] = useState(false);

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

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" backgroundColor="#6366f1" />
      <View style={styles.container}>
        <WebView
          ref={webViewRef}
          source={{ uri: TARGET_URL }}
          onNavigationStateChange={handleNavStateChange}
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#6366f1',
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
