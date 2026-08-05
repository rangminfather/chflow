# 브랜치 운영 규칙

이 저장소는 사람과 여러 코딩 에이전트(Claude / Codex)가 함께 편집한다.
2026-08-05 정리 작업에서 미병합 claude 브랜치 20개를 전수 점검한 결과를 규칙으로 굳힌 것이다.
작업 범위·디자인 토큰·커밋 메시지 등 그 밖의 규칙은 `CLAUDE.md`, `chflow-app/AGENTS.md` 를 따른다.

## 1. 브랜치는 목적당 하나

- 브랜치 하나 = 작업 하나. 이름은 `<에이전트>/<작업>` (`claude/live-notify`, `codex/android-v1-1-8`) 또는 `feature/<작업>`.
- **브랜치를 다른 기능의 저장소처럼 쓰지 않는다.** 한 브랜치에 관련 없는 기능을 계속 쌓으면
  나중에 무엇이 반영됐는지 판별 자체가 불가능해진다.
  (실제 사례: `claude/talent-system` 에 데스크톱 앱·메신저·달란트가 뒤섞여 39커밋이 미반영으로 남았다.)
- 새 작업 시작 전 **기존 관련 브랜치가 있는지 먼저 확인한다.**

  ```bash
  git fetch origin --prune
  git branch -a --list '*<키워드>*'
  ```

## 2. main 반영은 명시적으로

- main 반영은 PR 또는 명시적 merge commit(`git merge --no-ff`)으로 한다. 조용한 fast-forward 로 흘려보내지 않는다.
- 반영이 끝나면 **원격 브랜치를 즉시 삭제한다.**

  ```bash
  git push origin --delete <branch>
  git branch -d <branch>
  ```

- 배포는 현재 main 직접 푸시 → Vercel 자동배포 방식이다. 이 방식을 유지하는 동안
  main 을 "직접 푸시 금지"로 보호하면 배포가 멈춘다(아래 5절 참고).

## 3. 폐기 브랜치는 archive 태그를 남기고 삭제

되살릴 일이 없다고 판단한 브랜치도 흔적은 남긴다.

```bash
git tag -a archive/<branch-name>-<YYYYMMDD> <branch> -m "판정 근거와 이전 위치"
git push origin archive/<branch-name>-<YYYYMMDD>
git push origin --delete <branch>
git branch -D <branch>
# 복구
git checkout -b <name> archive/<branch-name>-<YYYYMMDD>
```

태그 메시지에는 **왜 폐기했는지와 유효분을 어디로 옮겼는지**를 적는다.
`archive/claude-*-20260805` 태그들이 예시다.

## 4. 오래된 브랜치는 통째로 병합하지 않는다

브랜치가 최신 main 보다 뒤처졌으면(수 주 이상) merge 하지 말고,
**최신 main 에서 새 브랜치를 만들어 필요한 변경만 옮긴다.**

```bash
git worktree add ../recover -b feature/recover-<원본> origin/main
cd ../recover
git cherry-pick -n <필요한 커밋>     # 파일 통째 복사 대신 커밋 단위로
```

이유: 옛 브랜치를 병합하면 그 사이 main 에서 이뤄진 리팩터가 되돌아간다.
`claude/talent-system` 을 통째 병합했다면 main 이 분리해둔 메신저 모달 리팩터가 통짜 파일로 역행했다.

### 반영 여부는 커밋 수가 아니라 내용으로 판단

`git log main..branch` 의 커밋 개수는 근거가 못 된다. cherry-pick·재작성으로 patch-id 가
달라지면 같은 내용도 "미반영"으로 보인다. 아래 네 가지를 함께 쓴다.

```bash
MB=$(git merge-base origin/main <branch>)

# 1) 완전 포함 여부 (참이면 잃을 것이 없다)
git merge-base --is-ancestor <branch> origin/main

# 2) patch-id 기준 미반영 커밋 (+ = main에 없음, - = 동일 패치 존재)
git cherry origin/main <branch>

# 3) 파일 내용 비교 — 이게 최종 판단 근거
git diff --quiet <branch> origin/main -- <file>   # 성공 = 내용 동일 = 반영됨

# 4) main 이 그 파일을 이후에 고쳤는지 (고쳤으면 브랜치 쪽이 구버전일 수 있다)
git log --oneline $MB..origin/main -- <file>
```

기능이 main 에 있는지는 **실제 코드로 확인한다** — RPC/함수/컴포넌트 이름을 `git grep` 해본다.
"main 에 파일이 없다"가 곧 "미반영"은 아니다. 의도적으로 삭제·흡수된 경우가 있다.
(예: `student-record` 페이지는 `31186e5` 에서 출결통합조회로 흡수되며 삭제됐다.)

## 5. DB·시크릿·배포

- DB 마이그레이션 파일은 브랜치에 준비만 하고, 운영 Supabase 적용은 **사용자 승인 후** 별도로 한다.
- 이미 적용된 마이그레이션 파일은 수정하지 않는다. 충돌 시 main 쪽을 유지한다.
- `.env.local` 등 시크릿은 어떤 브랜치·태그에도 커밋하지 않는다.

## 6. 여러 에이전트가 동시에 작업할 때

- 작업 트리를 공유하지 말고 `git worktree` 로 분리한다.
- 작업 시작 전 `git status --short` / `git log --oneline -3` 로 **내가 만들지 않은 변경이 있는지** 본다.
  있으면 섞지 말고 보고한다. 남의 미커밋 변경 위에서 브랜치를 갈아타지 않는다.
- 남의 미커밋 변경을 보존해야 할 때는 작업 트리를 건드리지 않는 임시 인덱스 방식을 쓴다.

  ```bash
  GIT_INDEX_FILE=/tmp/bk.idx git read-tree origin/main
  GIT_INDEX_FILE=/tmp/bk.idx git add -- <files>
  TREE=$(GIT_INDEX_FILE=/tmp/bk.idx git write-tree)
  git branch backup/<설명>-<YYYYMMDD> $(git commit-tree $TREE -p origin/main -m "chore(backup): ...")
  ```

## 7. 작업 종료 보고

작업을 마치면 다음을 보고한다.

- main 반영 여부(커밋 해시·푸시 여부)
- 최종 커밋
- 삭제한 브랜치(로컬/원격)와 생성한 archive 태그
- 남긴 브랜치와 그 이유
- 승인이 필요한 항목(main 병합, DB 적용, 배포)

## 8. 저장소 설정 (관리자 확인 필요)

- **머지 후 브랜치 자동 삭제**: Settings → General → "Automatically delete head branches" 활성화 권장.
  PR 방식으로 반영할 때 브랜치가 쌓이는 것을 막는다.
- **main 브랜치 보호**: 현재 배포가 main 직접 푸시에 의존하므로 "직접 푸시 차단"은 배포를 멈춘다.
  보호를 걸려면 force push 금지·브랜치 삭제 금지처럼 **푸시 자체를 막지 않는 항목만** 켠다.
