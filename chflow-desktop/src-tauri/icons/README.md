# 아이콘 (빌드 전 생성 필요)

이 폴더에는 아직 아이콘 바이너리가 없습니다. **Tauri 빌드 전 반드시 생성**해야 합니다.

로고 PNG(정사각형, 최소 1024×1024 권장) 하나를 준비한 뒤:

```
npm run tauri icon path/to/logo.png
```

위 명령이 `tauri.conf.json` 의 `bundle.icon` 목록(`32x32.png`, `128x128.png`,
`128x128@2x.png`, `icon.ico` 등)을 자동 생성합니다.

> 생성 전에는 `tauri build`/`tauri dev` 가 아이콘 없음으로 실패할 수 있습니다.
> 3단계에서는 아이콘 미포함(후속 작업) — 텍스트로 바이너리를 만들 수 없어 비워둠.
