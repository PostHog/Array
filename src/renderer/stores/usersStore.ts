import { create } from "zustand";

interface User {
  id: number;
  first_name?: string;
  last_name?: string;
  email: string;
}

interface UsersStore {
  users: User[];
  setUsers: (users: User[]) => void;
}

export const useUsersStore = create<UsersStore>((set) => ({
  users: [],
  setUsers: (users) => set({ users }),
}));
