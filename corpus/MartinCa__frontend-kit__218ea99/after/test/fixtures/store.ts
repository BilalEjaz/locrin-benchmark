// Regression fixture: DESIGN.md section 2 forbids fetching inside a Zustand
// store, and both call shapes have to be caught. The curried form is what the
// Zustand TypeScript docs use, and it went unflagged until the selector learned
// to look at callee.callee too.
interface Store {
  items: string[];
  load: () => Promise<void>;
}

type Initializer = (set: (partial: Partial<Store>) => void) => Store;

declare function create<T>(initializer: Initializer): T;
declare function create<T>(): (initializer: Initializer) => T;

export const usePlainStore = create<Store>((set) => ({
  items: [],
  load: async () => {
    const response = await fetch("/api/items");
    set({ items: (await response.json()) as string[] });
  },
}));

export const useCurriedStore = create<Store>()((set) => ({
  items: [],
  load: async () => {
    const response = await fetch("/api/items");
    set({ items: (await response.json()) as string[] });
  },
}));
