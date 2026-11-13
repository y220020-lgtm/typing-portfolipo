import { useEffect, useRef, useState } from "react";
import { api, keyboardChoice, setAuthMode, tokenStore, type AuthMode, type Session, type User } from "./api";
import { Login } from "./Login";
import { LevelSelect } from "./LevelSelect";
import { Play } from "./Play";
import { ResultView } from "./ResultView";
import { MyAnalysis } from "./MyAnalysis";
import { TeacherView } from "./TeacherView";
import { ManageLevels } from "./ManageLevels";
import { Icon } from "./Icon";
import { PlaySkeleton } from "./PlaySkeleton";
import { KeyboardSettings } from "./KeyboardSettings";
import { Assignments } from "./Assignments";
import { ThemeToggle } from "./ThemeToggle";

type Screen =
  | { name: "login" }
  | { name: "select" }
  | { name: "analysis" }
  | { name: "keyboards" }
  | { name: "teacher" }
  | { name: "manage" }
  | { name: "assignments" }
  | { name: "preparing" } // 苦手克服トレーニングの問題を待っている
  | { name: "play"; session: Session; training: boolean }
  | { name: "result"; sessionId: string; title: string; training: boolean };

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [screen, setScreen] = useState<Screen>({ name: "login" });
  const [checking, setChecking] = useState(true);
  const [mode, setMode] = useState<AuthMode>("local");
  const [signOutUrl, setSignOutUrl] = useState("/oauth2/sign_out");
  const [fatal, setFatal] = useState(""); // proxy 方式で本人を確かめられなかったとき（ログイン画面は出さない）

  // 起動時: ログインの方式を確かめる。
  // - proxy（研究室 Web サーバーの SSO）: ログインは済んでいるので、本人をサーバーから受け取る
  // - local: 再読み込みしたとき、保存しておいたトークンでログイン状態を戻す
  useEffect(() => {
    (async () => {
      try {
        const am = await api.authMode();
        const m = am.mode;
        setMode(m);
        setAuthMode(m);
        if (am.signOutUrl) setSignOutUrl(am.signOutUrl);
        if (m === "proxy" || tokenStore.get()) {
          try {
            const u = await api.me();
            setUser(u);
            setScreen(home(u));
          } catch (e) {
            if (m === "proxy") setFatal(e instanceof Error ? e.message : String(e));
            else tokenStore.clear();
          }
        }
      } catch (e) {
        setFatal(e instanceof Error ? e.message : String(e));
      } finally {
        setChecking(false);
      }
    })();
  }, []);

  // ブラウザの「戻る」: 記録・プレイ・結果の画面を開くとき履歴を 1 つ積み、「戻る」でレベル選択に戻す
  // （積まないと、ブラウザの「戻る」でアプリの外（前のページ）に出てしまう）
  useEffect(() => {
    const onPop = () => {
      waiting.current++; // 問題を待っている途中で戻ったら、あとで届いた問題は使わない
      setScreen((s) => (["analysis", "keyboards", "preparing", "play", "result"].includes(s.name) ? { name: "select" } : s));
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  // 苦手克服トレーニング: 待ちの画面（スケルトン）を出してから問題を頼み、届いたら練習画面へ。
  // 失敗したらレベル選択に戻り、理由を出す
  const waiting = useRef(0);
  const [notice, setNotice] = useState("");
  async function startTraining(keyboardId: number | null) {
    const id = ++waiting.current;
    setNotice("");
    openSub({ name: "preparing" });
    try {
      const session = await api.nextTraining(keyboardId);
      if (id === waiting.current) setScreen({ name: "play", session, training: true });
    } catch (e) {
      if (id !== waiting.current) return;
      setNotice(`問題を用意できませんでした: ${e instanceof Error ? e.message : String(e)}`);
      setScreen({ name: "select" });
    }
  }
  // レベルごとの苦手克服: 苦手克服トレーニングと同じく、待ちの画面を出してから問題を頼む
  async function startLevelTraining(levelId: number) {
    const id = ++waiting.current;
    setNotice("");
    setScreen({ name: "preparing" });
    try {
      const session = await api.levelTraining(levelId, keyboardChoice.get());
      if (id === waiting.current) setScreen({ name: "play", session, training: false });
    } catch (e) {
      if (id !== waiting.current) return;
      setNotice(`問題を用意できませんでした: ${e instanceof Error ? e.message : String(e)}`);
      setScreen({ name: "select" });
    }
  }
  function openSub(next: Screen) {
    if (!window.history.state?.sub) window.history.pushState({ sub: true }, "");
    setScreen(next);
  }
  function backToSelect() {
    if (window.history.state?.sub)
      window.history.back(); // popstate でレベル選択に戻る
    else setScreen({ name: "select" });
  }

  function home(u: User): Screen {
    return u.role === "teacher" ? { name: "teacher" } : { name: "select" };
  }

  async function logout() {
    if (mode === "proxy") {
      // SSO のログアウトは oauth2-proxy が行う（このアプリのログインを終える。Google 側のログインは残る）
      window.location.href = signOutUrl;
      return;
    }
    await api.logout().catch(() => undefined);
    tokenStore.clear();
    setUser(null);
    setScreen({ name: "login" });
  }

  if (checking)
    return (
      <div className="app">
        <AppHeader />
        <main>
          <p className="muted">読み込み中…</p>
        </main>
      </div>
    );
  if (fatal)
    return (
      <div className="app">
        <AppHeader />
        <main>
          <div className="card">
            <p className="error">{fatal}</p>
            {mode === "proxy" && (
              <p>
                <a href={signOutUrl}>このアプリからログアウトする</a>
                （別のアカウントで使うときは、Google からもログアウトしてから開き直してください）
              </p>
            )}
          </div>
        </main>
      </div>
    );

  return (
    <div className="app" data-screen={screen.name}>
      <AppHeader>
        {user && (
          <span className="user">
            <Icon name="user" />
            {/* 表示は「名前（ID）」のまま（テストと画面の読み上げで使う） */}
            <strong className="user-name-text">
              {user.name}（{user.id}）
            </strong>
            {user.role === "teacher" && <span className="role-badge">教員</span>}
            <button className="link" onClick={logout} aria-label="ログアウト" title="ログアウト">
              <Icon name="logout" />
              <span className="logout-text">ログアウト</span>
            </button>
          </span>
        )}
      </AppHeader>
      <main>
        {user?.role === "teacher" && (
          <nav className="tabs" aria-label="教員のメニュー">
            <button className={screen.name === "teacher" ? "active" : ""} onClick={() => setScreen({ name: "teacher" })}>
              <Icon name="users" />
              学生の学習状況
            </button>
            <button className={screen.name === "manage" ? "active" : ""} onClick={() => setScreen({ name: "manage" })}>
              <Icon name="layers" />
              ステージ・レベルの管理
            </button>
            <button className={screen.name === "assignments" ? "active" : ""} onClick={() => setScreen({ name: "assignments" })}>
              <Icon name="check" />
              課題
            </button>
            {/* 学生と同じ画面で練習する（記録は教員の ID で残り、学生一覧・課題・クラス全体の苦手には入らない） */}
            <button
              className={["select", "analysis", "keyboards", "preparing", "play", "result"].includes(screen.name) ? "active" : ""}
              onClick={() => setScreen({ name: "select" })}
            >
              <Icon name="keyboard" />
              練習（学生の画面）
            </button>
          </nav>
        )}
        {screen.name === "login" && mode === "local" && (
          <Login
            onLogin={(u) => {
              setUser(u);
              setScreen(home(u));
            }}
          />
        )}
        {screen.name === "select" && user && (
          <LevelSelect
            user={user}
            onStart={(session) => openSub({ name: "play", session, training: session.analysis !== undefined })}
            onAnalysis={() => openSub({ name: "analysis" })}
            onKeyboards={() => openSub({ name: "keyboards" })}
            onStartTraining={(keyboardId) => startTraining(keyboardId)}
            notice={notice}
          />
        )}
        {screen.name === "analysis" && <MyAnalysis onBack={backToSelect} />}
        {screen.name === "teacher" && <TeacherView />}
        {screen.name === "manage" && <ManageLevels />}
        {screen.name === "assignments" && <Assignments />}
        {screen.name === "preparing" && <PlaySkeleton />}
        {screen.name === "keyboards" && <KeyboardSettings onBack={backToSelect} />}
        {screen.name === "play" && user && (
          <Play
            session={screen.session}
            onFinish={() =>
              setScreen({ name: "result", sessionId: screen.session.sessionId, title: screen.session.level.title, training: screen.training })
            }
            onQuit={backToSelect}
          />
        )}
        {screen.name === "result" && (
          <ResultView
            sessionId={screen.sessionId}
            levelTitle={screen.title}
            onBack={backToSelect}
            onNextTraining={screen.training ? () => startTraining(keyboardChoice.get()) : undefined}
            onLevelTraining={screen.training ? undefined : startLevelTraining}
            onPlayLevel={
              screen.training
                ? undefined
                : async (levelId, retryOf) => {
                    try {
                      setScreen({ name: "play", session: await api.startSession(levelId, keyboardChoice.get(), retryOf), training: false });
                    } catch (e) {
                      setNotice(`始められませんでした: ${e instanceof Error ? e.message : String(e)}`);
                      setScreen({ name: "select" });
                    }
                  }
            }
          />
        )}
      </main>
    </div>
  );
}

// 画面の上の帯（どの画面も同じ）
function AppHeader({ children }: { children?: React.ReactNode }) {
  return (
    <header className="app-header">
      <div className="app-header-inner">
        <h1 className="brand">
          <span className="brand-mark">
            <Icon name="keyboard" />
          </span>
          タイピング練習
        </h1>
        <div className="header-actions">
          {children}
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
