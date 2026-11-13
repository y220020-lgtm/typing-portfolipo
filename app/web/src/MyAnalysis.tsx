import { useEffect, useState } from "react";
import { api, type Analysis } from "./api";
import { AnalysisView } from "./AnalysisView";
import { Icon } from "./Icon";

export function MyAnalysis({ onBack }: { onBack: () => void }) {
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api
      .myAnalysis()
      .then(setAnalysis)
      .catch((e) => setError(e.message));
  }, []);
  return (
    <div className="card">
      <button className="secondary" onClick={onBack}>
        <Icon name="back" />
        レベル選択に戻る
      </button>
      <h2 className="section-title">
        <Icon name="chart" />
        これまでの記録
      </h2>
      {error && (
        <p className="error" role="alert">
          <Icon name="alert" />
          {error}
        </p>
      )}
      {!analysis && !error && <p className="muted">集計しています…</p>}
      {analysis && <AnalysisView analysis={analysis} />}
      {/* 記録は縦に長いので、下にも戻るボタンを置く */}
      {analysis && (
        <button className="secondary" onClick={onBack}>
          <Icon name="back" />
          レベル選択に戻る
        </button>
      )}
    </div>
  );
}
