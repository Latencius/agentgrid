# AgentGrid - CLAUDE.md

Claude Code がこのプロジェクトを理解するためのコンテキストファイルです。
**作業開始前に必ずこのファイルを読んでください。**

---

## このプロジェクトは何か

複数の Claude Code / Gemini CLI / Codex エージェントを並列起動して、一つのプロジェクトを分業させるための**統合管理ダッシュボード**です。

```
[AgentGrid Dashboard] ← WebUI でエージェントを監視・操作
        ↓ WebSocket
[Orchestrator Server] ← タスク分配・ロック管理・ログ集約
        ↓ PTY or SDK
[Worker Agents ×N]   ← Claude Code / Gemini CLI / Codex が実際にコードを書く
        ↓
[Judge Agent]         ← 完了コードを採点してスコアを返す
```

---

## ディレクトリ構成（重要）

```
agentgrid/
├── packages/
│   ├── orchestrator/   ← Node.js サーバー（TypeScript）
│   └── dashboard/      ← Vue 3 フロントエンド
├── .agentgrid/
│   ├── locks/          ← タスクロックファイル（*.lock）
│   ├── logs/           ← エージェントログ
│   └── worktrees/      ← git worktree
├── agentgrid.config.json
└── CLAUDE.md           ← このファイル
```

---

## 技術スタック

| レイヤー | 技術 |
|---|---|
| フロントエンド | Vue 3 + Vite + Pinia |
| バックエンド | Node.js + Express + TypeScript |
| DB | SQLite（better-sqlite3） |
| リアルタイム通信 | WebSocket（ws ライブラリ） |
| PTY通信 | node-pty |
| テスト | Vitest |

---

## コーディングルール

### TypeScript
- `strict: true` を必ず守る
- `any` は使わない。型が不明な場合は `unknown` を使い、型ガードを書く
- インターフェースはファイルの先頭に定義する

### 非同期処理
- `async/await` を使う（コールバックは使わない）
- エラーは必ず `try/catch` で処理し、ログに記録する
- Promise の握り潰しは禁止

### ファイル・関数のサイズ
- 1ファイルは 300行以内を目安にする
- 1関数は 50行以内を目安にする
- 長くなりそうなら迷わず分割する

### 命名規則
- クラス・インターフェース: `PascalCase`
- 関数・変数: `camelCase`
- 定数: `UPPER_SNAKE_CASE`
- Vueコンポーネント: `PascalCase.vue`

---

## 重要な設計方針（必ず守ること）

### 1. AgentRunner は必ず抽象クラス経由で使う

```typescript
// ✅ 正しい
const runner: AgentRunner = RunnerFactory.create(config)
await runner.start()

// ❌ 禁止（具体クラスを直接使わない）
const runner = new PTYRunner()
```

### 2. ファイルロックの取得・解放は必ず LockManager 経由

```typescript
// ✅ 正しい
const lock = await lockManager.acquire(taskId, agentId)
try {
  // 作業
} finally {
  await lock.release()
}

// ❌ 禁止（直接ファイル操作しない）
fs.writeFileSync(`.agentgrid/locks/${taskId}.lock`, ...)
```

### 3. WebSocket イベントはイベント名を定数で管理

```typescript
// packages/orchestrator/src/ws/events.ts で一元管理
export const WS_EVENTS = {
  AGENT_STATUS: 'agent:status',
  AGENT_LOG: 'agent:log',
  TASK_STATUS: 'task:status',
  SCORE_UPDATED: 'score:updated',
  COST_UPDATED: 'cost:updated',
} as const
```

### 4. SQLite へのアクセスは db.ts のみ

直接 better-sqlite3 を import しない。必ず `store/db.ts` の関数を使う。

---

## MVP 実装ステップ（この順番で進めること）

現在のステップを確認してから作業を開始してください。

- [ ] **Step 1**: `packages/orchestrator/src/store/db.ts` - SQLite初期化・タスクCRUD
- [ ] **Step 2**: `packages/orchestrator/src/runners/` - AgentRunner抽象クラス + PTYRunner
- [ ] **Step 3**: `packages/orchestrator/src/services/LockManager.ts`
- [ ] **Step 4**: `packages/orchestrator/src/services/WorktreeManager.ts`
- [ ] **Step 5**: `packages/orchestrator/src/ws/socket.ts` - WebSocket サーバー
- [ ] **Step 6**: `packages/orchestrator/src/api/` - REST API エンドポイント
- [x] **Step 7**: `packages/dashboard/src/components/AgentGrid.vue` - グリッドビュー
- [ ] **Step 8**: `packages/dashboard/src/components/TaskBoard.vue` - タスクボード
- [x] **Step 9**: `packages/orchestrator/src/services/JudgeAgent.ts` - 評価エージェント
- [ ] **Step 10**: `packages/dashboard/src/components/ScoreCard.vue` - スコアカード

---

## タスクを受け取ったときの動作

1. このファイルを読む（済）
2. `agentgrid.config.json` を確認する
3. 該当する Step のファイルのみを編集する（**スコープ外のファイルは触らない**）
4. 実装後は `npm run build` でビルドエラーがないことを確認する
5. 完了したら `[完了] {実装内容} を実装しました` と報告する

---

## よくあるミス（やらないこと）

- `agentgrid.config.json` を勝手に変更しない
- `.agentgrid/locks/` 内のファイルを直接読み書きしない
- 他のエージェントが担当している Step のファイルを編集しない
- `console.log` デバッグを残したままにしない（`logger.ts` を使う）
- テストを書かずに「完了」と報告しない

---

## 参考ドキュメント

- 要件定義書: `docs/requirements.md`
- 技術設計書: `docs/technical_design.md`
- REST API 仕様: 技術設計書 セクション4
- WebSocket イベント仕様: 技術設計書 セクション5
