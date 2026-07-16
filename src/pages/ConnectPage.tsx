import { ConnectGrid } from "../components/connect/ConnectGrid";

export function ConnectPage() {
  return (
    <div className="connect-page">
      <div className="page-top">
        <h1 className="page-heading">Connect</h1>
      </div>
      <p className="page-lede">Bring your favorite tools into ArcSonare.</p>
      <ConnectGrid />
    </div>
  );
}
