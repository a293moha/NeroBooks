import { useNavigate } from "react-router-dom";

export default function UpgradeBanner({ message }: { message: string }) {
  const navigate = useNavigate();
  return (
    <div className="upgrade-banner">
      <span>🔒 {message}</span>
      <button className="btn-primary upgrade-banner-btn" onClick={() => navigate("/billing")}>
        Upgrade to Pro
      </button>
    </div>
  );
}
