# AgentGrid 技術設計書

> バージョン: 0.1.0  
> 作成日: 2026-03-31

---

## 1. ディレクトリ構成

```
agentgrid/
├── packages/
│   ├── orchestrator/          # Orchestratorサーバー（Node.js）
│   │   ├── src/
│   │   │   ├── index.ts               # エントリーポイント・サーバー起動
│   │   │   ├── api/
│   │   │   │   ├── tasks.ts           # タスクCRUD API
│   │   │   │   ├── agents.ts          # エージェント管理API
│   │   │   │   └── metrics.ts         # コスト・スコア取得API
│   │   │   ├── runners/
│   │   │   │   ├── AgentRunner.ts     # 共通インターフェース（抽象クラス）
│   │   │   │   ├── PTYRunner.ts       # PTY実装
│   │   │   │   └── SDKRunner.ts       # SDK実装
│   │   │   ├── services/
│   │   │   │   ├── TaskQueue.ts       # タスクキュー管理
│   │   │   │   ├── LockManager.ts     # ファイルロック管理
│   │   │   │   ├── WorktreeManager.ts # git worktree管理
│   │   │   │   └── JudgeAgent.ts      # 評価エージェント
│   │   │   ├── store/
│   │   │   │   └── db.ts              # SQLite（タスク・ログ永続化）
│   │   │   └── ws/
│   │   │       └── socket.ts          # WebSocketサーバー
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── dashboard/             # フロントエンド（Vue 3）
│       ├── src/
│       │   ├── main.ts
│       │   ├── App.vue
│       │   ├── components/
│       │   │   ├── AgentGrid.vue      # エージェント一覧グリッド
│       │   │   ├── AgentCard.vue      # 個別エージェントカード
│       │   │   ├── TaskBoard.vue      # タスク管理ボード
│       │   │   ├── ScoreCard.vue      # Judge結果スコアカード
│       │   │   ├── RadarChart.vue     # レーダーチャート
│       │   │   ├── CostMeter.vue      # コスト表示
│       │   │   └── TerminalView.vue   # エージェント出力表示
│       │   ├── stores/
│       │   │   ├── agents.ts          # Pinia: エージェント状態
│       │   │   ├── tasks.ts           # Pinia: タスク状態
│       │   │   └── metrics.ts         # Pinia: コスト・スコア
│       │   └── composables/
│       │       └── useWebSocket.ts    # WebSocket接続管理
│       ├── package.json
│       └── vite.config.ts
│
├── agentgrid.config.json      # ユーザー設定ファイル
├── .agentgrid/
│   ├── locks/                 # ロックファイル置き場
│   ├── logs/                  # エージェントログ
│   └── worktrees/             # git worktree置き場
├── CLAUDE.md                  # Claude Code用コンテキストファイル
└── package.json               # ルートワークスペース
```

---

## 2. 設定ファイル仕様

### agentgrid.config.json
```json
{
  "runner": "pty",              // "pty" | "sdk"
  "maxAgents": 10,
  "repo": "./",                 // 対象リポジトリのパス
  "agents": [
    {
      "id": "worker-1",
      "type": "claude-code",    // "claude-code" | "gemini-cli" | "codex"
      "runner": "pty"           // エージェント個別に上書き可
    }
  ],
  "judge": {
    "enabled": true,
    "type": "claude-code",    // "claude-code" | "gemini-cli" | "codex"
    "runner": "sdk",
    "scoreItems": ["completion", "quality", "security", "ux", "tests"]
  },
  "cost": {
    "alertThreshold": 10.0,     // USD
    "currency": "JPY"
  }
}
```

---

## 3. データモデル（SQLite）

### tasks テーブル
```sql
CREATE TABLE tasks (
  id          TEXT PRIMARY KEY,   -- UUID
  title       TEXT NOT NULL,
  description TEXT,
  status      TEXT NOT NULL,      -- 'pending' | 'running' | 'done' | 'failed'
  agent_id    TEXT,               -- アサインされたエージェントID
  depends_on  TEXT,               -- 依存タスクID（JSON配列）
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  started_at  DATETIME,
  finished_at DATETIME
);
```

### agents テーブル
```sql
CREATE TABLE agents (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL,      -- 'claude-code' | 'gemini-cli' | 'codex'
  runner      TEXT NOT NULL,      -- 'pty' | 'sdk'
  status      TEXT NOT NULL,      -- 'idle' | 'running' | 'stopped' | 'error'
  worktree    TEXT,               -- worktreeのパス
  current_task_id TEXT,
  tokens_used INTEGER DEFAULT 0,
  cost_usd    REAL DEFAULT 0.0,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### scores テーブル
```sql
CREATE TABLE scores (
  id          TEXT PRIMARY KEY,
  task_id     TEXT NOT NULL,
  agent_id    TEXT NOT NULL,
  completion  INTEGER,            -- 0-100
  quality     INTEGER,
  security    INTEGER,
  ux          INTEGER,
  tests       INTEGER,
  comment     TEXT,               -- Judgeの総評
  judged_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (task_id) REFERENCES tasks(id)
);
```

### logs テーブル
```sql
CREATE TABLE logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id    TEXT NOT NULL,
  task_id     TEXT,
  content     TEXT NOT NULL,      -- ターミナル出力の1行
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

## 4. REST API 仕様

### タスク管理
| Method | Path | 説明 |
|---|---|---|
| GET | /api/tasks | タスク一覧取得 |
| POST | /api/tasks | タスク作成 |
| PATCH | /api/tasks/:id | タスク更新 |
| DELETE | /api/tasks/:id | タスク削除 |
| POST | /api/tasks/:id/assign | エージェントにアサイン |

### エージェント管理
| Method | Path | 説明 |
|---|---|---|
| GET | /api/agents | エージェント一覧 |
| POST | /api/agents | エージェント追加 |
| POST | /api/agents/:id/start | エージェント起動 |
| POST | /api/agents/:id/stop | エージェント停止 |
| POST | /api/agents/:id/message | エージェントにメッセージ送信 |
| GET | /api/agents/:id/logs | ログ取得 |

### メトリクス
| Method | Path | 説明 |
|---|---|---|
| GET | /api/metrics/cost | コスト集計 |
| GET | /api/scores/:taskId | タスクのスコア取得 |

---

## 5. WebSocket イベント仕様

### Server → Client
```typescript
// エージェント状態変化
{ event: 'agent:status', data: { agentId, status } }

// ターミナル出力（リアルタイム）
{ event: 'agent:log', data: { agentId, line } }

// タスク状態変化
{ event: 'task:status', data: { taskId, status, agentId } }

// スコア更新
{ event: 'score:updated', data: { taskId, scores } }

// コスト更新
{ event: 'cost:updated', data: { agentId, tokensUsed, costUsd } }
```

### Client → Server
```typescript
// エージェントに割り込みメッセージ
{ event: 'agent:send', data: { agentId, message } }
```

---

## 6. AgentRunner インターフェース

```typescript
// packages/orchestrator/src/runners/AgentRunner.ts

export interface AgentRunnerConfig {
  agentId: string
  type: 'claude-code' | 'gemini-cli' | 'codex'
  worktree: string
  taskDescription: string
}

export abstract class AgentRunner {
  abstract start(config: AgentRunnerConfig): Promise<void>
  abstract stop(): Promise<void>
  abstract send(message: string): Promise<void>
  abstract onLog(callback: (line: string) => void): void
  abstract onFinish(callback: (exitCode: number) => void): void
  abstract getTokensUsed(): number
}
```

---

## 7. LockManager 仕様

```typescript
// .agentgrid/locks/{taskId}.lock の中身
{
  "agentId": "worker-1",
  "pid": 12345,
  "lockedAt": "2026-03-31T00:00:00Z"
}
```

**ロック取得フロー:**
1. `.lock` ファイルが存在するか確認
2. 存在する場合、PIDが生きているか `process.kill(pid, 0)` でチェック
3. PIDが死んでいれば `.lock` を削除してロック取得
4. PIDが生きていれば取得失敗（別エージェントが使用中）

---

## 8. Judge Agent 仕様

### 入力プロンプト（テンプレート）
```
以下の git diff を評価してください。

タスク概要: {taskDescription}

--- diff ---
{gitDiff}
---

以下の項目を0-100で採点し、JSONのみで返してください：
{
  "completion": <実装完了度>,
  "quality": <コード品質>,
  "security": <セキュリティ>,
  "ux": <UX/エラー処理>,
  "tests": <テスト・検証>,
  "comment": "<総評 100字以内>"
}
```

### Judge Agent の起動タイミング
- Worker Agent のプロセスが exit code 0 で終了したとき
- ダッシュボードから手動トリガーしたとき

---

## 9. npm パッケージとして配布

### bin コマンド
```bash
agentgrid start          # Orchestrator + Dashboard を起動
agentgrid start --port 3000
agentgrid agent add      # エージェントをインタラクティブに追加
agentgrid task add       # タスクをインタラクティブに追加
agentgrid status         # 現在の状態を CLI で確認
```

### package.json（ルート）
```json
{
  "name": "agentgrid",
  "version": "0.1.0",
  "bin": {
    "agentgrid": "./packages/orchestrator/dist/cli.js"
  },
  "scripts": {
    "build": "npm run build --workspaces",
    "dev": "concurrently \"npm run dev -w orchestrator\" \"npm run dev -w dashboard\""
  }
}
```

---

## 10. 開発優先順位（MVP実装順）

```
Step 1: Orchestrator 基盤
  └── SQLite初期化 + タスクCRUD API

Step 2: AgentRunner（PTYのみ）
  └── Claude Code をプロセス起動・ログ取得

Step 3: LockManager + WorktreeManager
  └── タスク排他制御 + worktree自動作成

Step 4: WebSocket
  └── リアルタイムログ配信

Step 5: Dashboard - AgentGrid ビュー
  └── エージェント一覧・ターミナル出力表示

Step 6: Dashboard - TaskBoard ビュー
  └── タスク作成・アサイン

Step 7: Judge Agent + ScoreCard
  └── 完了タスクの自動評価・スコア表示

Step 8: コスト集計 + CostMeter
Step 9: SDKRunner 追加
Step 10: CLI コマンド整備・npm publish
```
