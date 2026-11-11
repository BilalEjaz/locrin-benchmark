export type User = {
  id: string;
  email: string;
  username: string;
  timezone: string;
  createdAt: string;
  displayName: string | null;
  bio: string | null;
  location: string | null;
  avatarUrl: string | null;
};

/** Every profile field is optional, so an update sends only what changed. */
export type ProfileInput = {
  username?: string;
  timezone?: string;
  displayName?: string;
  bio?: string;
  location?: string;
  avatarUrl?: string;
};

export type Tile = { date: string; done: boolean; verified: boolean };

export type GlobalRow = {
  userId: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  isYou: boolean;
  taskCount: number;
  currentStreak: number;
  longestStreak: number;
  activeDays: number;
  verifiedDays: number;
};

export type GlobalBoard = {
  totals: { members: number; tasks: number; days: number; verified: number };
  board: GlobalRow[];
  yourRank: number | null;
};

/** One of the sites a task can be attached to, as listed by GET /platforms. */
export type Platform = {
  id: string;
  label: string;
  emoji: string;
  placeholder: string;
  hint: string;
};

/** A handle you've linked. */
export type LinkedProfile = {
  platform: string;
  label: string;
  emoji: string;
  handle: string;
  url: string | null;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
};

/** What one platform's sync did, reported per platform so one failure isn't fatal. */
export type SyncResult = {
  platform: string;
  label: string;
  ok: boolean;
  added: number;
  activeDays?: number;
  error: string | null;
};

/** A task's platform tag. `url` is null until you link that handle in Profile. */
export type TaskPlatform = {
  id: string;
  label: string;
  emoji: string;
  handle: string | null;
  url: string | null;
  lastSyncedAt: string | null;
};

export type TaskSummary = {
  id: string;
  title: string;
  description: string | null;
  startedOn: string;
  currentStreak: number;
  longestStreak: number;
  totalDays: number;
  doneToday: boolean;
  syncedDays: number;
  platform: TaskPlatform | null;
  /** Set when this task is your copy of a group challenge. */
  group: { id: string; name: string } | null;
  tiles: Tile[];
};

export type HeatmapDay = { date: string; completed: number; total: number };

/** One completion, with the instant it was recorded — what the activity feed reads. */
export type RecentEvent = {
  taskId: string;
  title: string;
  platform: string | null;
  source: "manual" | "synced";
  localDate: string;
  at: string;
};

export type Dashboard = {
  today: string;
  timezone: string;
  tasks: TaskSummary[];
  profiles: LinkedProfile[];
  heatmap: HeatmapDay[];
  recent: RecentEvent[];
};

export type GroupSummary = {
  id: string;
  name: string;
  inviteCode: string;
  isOwner: boolean;
  memberCount: number;
  challengeCount: number;
  yourRank: number | null;
  owedToday: boolean;
};

/** The group list, plus how many distinct people you share a group with. */
export type GroupList = { groups: GroupSummary[]; peers: number };

export type GroupChallenge = {
  id: string;
  title: string;
  platform: { id: string; label: string; emoji: string } | null;
  /** Null once whoever suggested it has left the group. */
  addedBy: string | null;
};

/** A public group you aren't in yet. */
export type DiscoverableGroup = {
  id: string;
  name: string;
  description: string | null;
  memberCount: number;
  challengeCount: number;
};

export type StandingEntry = {
  challengeId: string;
  joined: boolean;
  currentStreak: number;
  longestStreak: number;
  totalDays: number;
  doneToday: boolean;
};

export type Standing = {
  userId: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  isYou: boolean;
  score: number;
  doneToday: number;
  challenges: StandingEntry[];
};

export type MessageFile = { name: string; type: string; size: number };

export type GroupMessage = {
  id: string;
  body: string;
  createdAt: string;
  file: MessageFile | null;
  author: {
    userId: string;
    username: string;
    displayName: string | null;
    avatarUrl: string | null;
  };
};

export type GroupDetail = {
  group: {
    id: string;
    name: string;
    description: string | null;
    visibility: "public" | "private";
    inviteCode: string;
    createdAt: string;
    isOwner: boolean;
    ownerId: string;
  };
  challenges: GroupChallenge[];
  standings: Standing[];
};

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    credentials: "include",
    headers:
      options.body && !(options.body instanceof FormData)
        ? { "Content-Type": "application/json" }
        : undefined,
    ...options,
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(body.error ?? "Something went wrong", response.status);
  }
  return body as T;
}

const post = (path: string, body?: unknown) =>
  request<{ ok?: boolean }>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined });

export const api = {
  me: () => request<{ user: User }>("/auth/me").then((r) => r.user),

  register: (input: { email: string; username: string; password: string; timezone: string }) =>
    request<{ user: User }>("/auth/register", {
      method: "POST",
      body: JSON.stringify(input),
    }).then((r) => r.user),

  login: (input: { emailOrUsername: string; password: string }) =>
    request<{ user: User }>("/auth/login", {
      method: "POST",
      body: JSON.stringify(input),
    }).then((r) => r.user),

  logout: () => post("/auth/logout"),

  updateProfile: (input: ProfileInput) =>
    request<{ user: User }>("/auth/me", {
      method: "PATCH",
      body: JSON.stringify(input),
    }).then((r) => r.user),

  uploadAvatar: (file: File) => {
    const form = new FormData();
    form.append("avatar", file);
    return request<{ user: User }>("/auth/me/avatar", { method: "POST", body: form }).then(
      (r) => r.user,
    );
  },

  dashboard: (days = 30) => request<Dashboard>(`/dashboard?days=${days}`),

  createTask: (title: string, platform: string | null) => post("/tasks", { title, platform }),

  updateTask: (id: string, input: { title?: string; description?: string }) =>
    request<{ ok: boolean }>(`/tasks/${id}`, { method: "PATCH", body: JSON.stringify(input) }),

  platforms: () => request<{ platforms: Platform[] }>("/platforms").then((r) => r.platforms),

  profiles: () => request<{ profiles: LinkedProfile[] }>("/profiles").then((r) => r.profiles),

  linkProfile: (platform: string, handle: string) =>
    request<{ profile: LinkedProfile }>(`/profiles/${platform}`, {
      method: "PUT",
      body: JSON.stringify({ handle }),
    }).then((r) => r.profile),

  unlinkProfile: (platform: string) =>
    request<{ ok: boolean }>(`/profiles/${platform}`, { method: "DELETE" }),

  deleteTask: (id: string) => request<{ ok: boolean }>(`/tasks/${id}`, { method: "DELETE" }),

  complete: (id: string, date: string) => post(`/tasks/${id}/complete`, { date }),

  global: () => request<GlobalBoard>("/global"),

  groups: () => request<GroupList>("/groups"),

  createGroup: (input: { name: string; description?: string; visibility?: string }) =>
    request<{ group: { id: string; name: string; inviteCode: string } }>("/groups", {
      method: "POST",
      body: JSON.stringify(input),
    }).then((r) => r.group),

  updateGroup: (id: string, input: { name?: string; description?: string; visibility?: string }) =>
    request<{ group: { id: string; name: string } }>(`/groups/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }).then((r) => r.group),

  discoverGroups: () =>
    request<{ groups: DiscoverableGroup[] }>("/groups/discover").then((r) => r.groups),

  joinPublicGroup: (id: string) =>
    request<{ group: { id: string; name: string }; alreadyMember?: boolean }>(
      `/groups/${id}/join`,
      { method: "POST" },
    ),

  joinGroup: (code: string) =>
    request<{ group: { id: string; name: string }; alreadyMember?: boolean }>("/groups/join", {
      method: "POST",
      body: JSON.stringify({ code }),
    }),

  group: (id: string) => request<GroupDetail>(`/groups/${id}`),

  createChallenge: (groupId: string, title: string, platform: string | null) =>
    post(`/groups/${groupId}/tasks`, { title, platform }),

  deleteChallenge: (groupId: string, challengeId: string) =>
    request<{ ok: boolean }>(`/groups/${groupId}/tasks/${challengeId}`, { method: "DELETE" }),

  messages: (groupId: string, after?: string) =>
    request<{ messages: GroupMessage[] }>(
      `/groups/${groupId}/messages${after ? `?after=${after}` : ""}`,
    ).then((r) => r.messages),

  // Multipart when there's a file: the fetch wrapper only sets a JSON content-type
  // when it's given a body it serialised itself, so FormData sets its own boundary.
  sendMessage: (groupId: string, body: string, file?: File | null) => {
    if (!file) {
      return request<{ message: GroupMessage }>(`/groups/${groupId}/messages`, {
        method: "POST",
        body: JSON.stringify({ body }),
      }).then((r) => r.message);
    }
    const form = new FormData();
    form.append("body", body);
    form.append("file", file);
    return request<{ message: GroupMessage }>(`/groups/${groupId}/messages`, {
      method: "POST",
      body: form,
    }).then((r) => r.message);
  },

  attachmentUrl: (groupId: string, messageId: string) =>
    `/api/groups/${groupId}/messages/${messageId}/file`,

  leaveGroup: (id: string) => post(`/groups/${id}/leave`),

  deleteGroup: (id: string) => request<{ ok: boolean }>(`/groups/${id}`, { method: "DELETE" }),

  syncAll: () =>
    request<{ results: SyncResult[]; message?: string }>("/sync", { method: "POST" }),

  syncTask: (id: string) =>
    request<{ results: SyncResult[]; message?: string }>(`/tasks/${id}/sync`, { method: "POST" }),

  uncomplete: (id: string, date: string) =>
    request<{ ok: boolean }>(`/tasks/${id}/complete/${date}`, { method: "DELETE" }),
};
