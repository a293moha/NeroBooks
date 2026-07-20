import { useState } from "react";
import { useAuth } from "../context/AuthContext";
import { useTeam } from "../context/TeamContext";
import { planLimits } from "../lib/planLimits";
import { initials } from "../lib/format";
import Modal from "../components/Modal";
import UpgradeBanner from "../components/UpgradeBanner";
import { PlusIcon } from "../components/icons";

export default function Team() {
  const { user } = useAuth();
  const { invitees, addInvitee, removeInvitee } = useTeam();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");

  if (!user) return null;

  const limits = planLimits[user.plan];
  const totalMembers = invitees.length + 1;
  const atCap = totalMembers >= limits.maxTeamMembers;

  const submit = () => {
    if (!name.trim() || !email.trim() || atCap) return;
    addInvitee({ name: name.trim(), email: email.trim() });
    setName("");
    setEmail("");
    setOpen(false);
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Team</h1>
          <p className="page-subtitle">
            {totalMembers} of {limits.maxTeamMembers === Infinity ? "unlimited" : limits.maxTeamMembers} members ·{" "}
            {limits.label} plan
          </p>
        </div>
        <button className="btn-new" onClick={() => setOpen(true)} disabled={atCap}>
          <PlusIcon />
          Invite member
        </button>
      </div>

      {atCap && limits.maxTeamMembers !== Infinity && (
        <UpgradeBanner message={`You've reached the ${limits.maxTeamMembers}-member limit on the Starter plan.`} />
      )}

      <div className="table-card">
        <table>
          <thead>
            <tr>
              <th>Member</th>
              <th>Email</th>
              <th>Role</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span className="avatar-chip" style={{ cursor: "default" }}>
                    {initials(user.name)}
                  </span>
                  {user.name} <span className="cell-muted">(you)</span>
                </div>
              </td>
              <td className="cell-muted">{user.email}</td>
              <td className="cell-muted">Owner</td>
              <td></td>
            </tr>
            {invitees.map((m) => (
              <tr key={m.id}>
                <td>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span
                      style={{
                        width: 30,
                        height: 30,
                        borderRadius: "50%",
                        background: "var(--brand-yellow-light)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 12,
                        fontWeight: 700,
                      }}
                    >
                      {initials(m.name)}
                    </span>
                    {m.name}
                  </div>
                </td>
                <td className="cell-muted">{m.email}</td>
                <td className="cell-muted">Member</td>
                <td className="cell-num">
                  <button className="remove-line-btn" onClick={() => removeInvitee(m.id)} title="Remove member">
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {open && (
        <Modal
          title="Invite team member"
          onClose={() => setOpen(false)}
          footer={
            <>
              <button className="btn-secondary" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button className="btn-primary" onClick={submit}>
                Send invite
              </button>
            </>
          }
        >
          <div>
            <label>Full name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Doe" />
          </div>
          <div>
            <label>Email</label>
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jane@company.com" />
          </div>
        </Modal>
      )}
    </div>
  );
}
