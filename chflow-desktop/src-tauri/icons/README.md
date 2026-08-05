# 아이콘 — ⚠️ 임시 개발용 자산

이 폴더의 아이콘들은 **빌드 차단을 막기 위한 임시 placeholder**입니다.
(녹색 배경에 "C" 글자 — `tauri icon`으로 생성)

- **최종 CHFlow 브랜드 아이콘이 아닙니다.** 디자인 확정 후 교체해야 할 항목입니다.
- Windows 전용 프로젝트이므로 iOS/Android 자산은 생성하지 않았습니다(생성 시 제거).

## 교체 방법
최종 로고 PNG(정사각형, 1024×1024 권장)를 준비한 뒤 `chflow-desktop/` 디렉터리에서:

```
npm run tauri icon <최종로고.png>
```

> 주의: `npm run`은 cwd를 `chflow-desktop/`로 바꾸므로, `-o` 옵션을 줄 때 경로는
> `chflow-desktop/` 기준 상대경로(예: `src-tauri/icons`)로 지정하세요.
> (기본 출력 위치가 이미 `src-tauri/icons` 이므로 `-o` 생략 가능.)

## 현재 포함 파일
`32x32.png`, `64x64.png`, `128x128.png`, `128x128@2x.png`, `icon.ico`, `icon.png`,
`icon.icns`(mac, 미사용), Windows Store `Square*Logo.png` / `StoreLogo.png`.
`tauri.conf.json` 의 `bundle.icon` 은 `32x32.png`, `128x128.png`, `128x128@2x.png`, `icon.ico` 참조.
