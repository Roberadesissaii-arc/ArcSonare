import { ConnectGrid } from "../components/connect/ConnectGrid";

export function ConnectPage() {
  return (
    <div className="connect-page">
      <div className="page-top">
        <div>
          <h1 className="page-heading">Connect</h1>
          <p className="page-lede">
            Bring your favorite tools into ArcSonare. Filter by category or
            search — OAuth arrives with the service backend.
          </p>
        </div>
      </div>
      <ConnectGrid />
    </div>
  );
}
