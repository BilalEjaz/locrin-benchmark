import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { achievementsFor } from "../lib/achievements";
import { useAppData } from "../context/AppData";
import { useAuth } from "../context/AuthContext";
import LinkedProfiles from "../components/LinkedProfiles";
import ProfileEditor from "../components/ProfileEditor";
import AboutMe from "../components/profile/AboutMe";
import Achievements from "../components/profile/Achievements";
import ProfileHero from "../components/profile/ProfileHero";
import ProfileStats from "../components/profile/ProfileStats";
import StreakProgress from "../components/profile/StreakProgress";

export default function Profile() {
  const { user } = useAuth();
  const { dashboard, groups, peers } = useAppData();
  const [rank, setRank] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    // The only number on this page the shared context doesn't already hold.
    api
      .global()
      .then((board) => setRank(board.yourRank))
      .catch(() => setRank(null));
  }, [user]);

  if (!user) return null;

  const tasks = dashboard?.tasks ?? [];
  const streakDays = tasks.reduce((sum, task) => sum + task.totalDays, 0);
  const verified = tasks.some((task) => task.syncedDays > 0);
  const achievements = achievementsFor(dashboard, rank);

  return (
    <div className="dashboard">
      <ProfileHero
        user={user}
        peers={peers}
        verified={verified}
        onEdit={() => setEditing(true)}
        onEditPhoto={() => setEditing(true)}
      />

      <ProfileStats
        streakDays={streakDays}
        tasksCompleted={streakDays}
        globalRank={rank}
        activeGroups={groups?.length ?? 0}
        achievements={achievements.filter((a) => a.earned).length}
      />

      <div className="profile-grid">
        {dashboard ? (
          <StreakProgress data={dashboard} />
        ) : (
          <div className="skeleton" style={{ height: 280, borderRadius: "var(--radius-lg)" }} />
        )}
        <AboutMe user={user} peers={peers} onEdit={() => setEditing(true)} />
      </div>

      <div className="profile-grid">
        <LinkedProfiles />
        <Achievements achievements={achievements} />
      </div>

      {editing && <ProfileEditor onClose={() => setEditing(false)} />}
    </div>
  );
}
