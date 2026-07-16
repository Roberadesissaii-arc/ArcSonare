/**
 * Local task state, persisted to localStorage. Seeded once with demo tasks
 * (marked via `demo: true`) so the dashboard has content before any real
 * integration exists.
 */
import { useSyncExternalStore } from "react";
import { DEMO_TASKS } from "../data/demoData";

export type TaskPriority = "high" | "medium" | "low";
export type TaskFilter = "all" | "today" | "upcoming" | "urgent" | "completed";
export type DueBucket = "today" | "upcoming" | "none";

export interface Task {
  id: string;
  title: string;
  note?: string;
  priority: TaskPriority;
  /** Human-readable due label ("Today, 12:00 PM"). */
  due?: string;
  dueBucket: DueBucket;
  agent?: string;
  completed: boolean;
  urgent: boolean;
  demo?: boolean;
  createdAt: number;
}

const STORAGE_KEY = "arcsonare.tasks.v1";
const listeners = new Set<() => void>();

function load(): Task[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as Task[];
  } catch (err) {
    console.error("[ArcSonare] failed to load tasks:", err);
  }
  return DEMO_TASKS.map((t) => ({ ...t }));
}

let tasks: Task[] = load();

function persist() {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
  } catch (err) {
    console.error("[ArcSonare] failed to persist tasks:", err);
  }
}

function emit() {
  persist();
  listeners.forEach((l) => l());
}

export function newTaskId(): string {
  return `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function addTask(
  input: Omit<Task, "id" | "completed" | "createdAt">,
): Task {
  const task: Task = {
    ...input,
    id: newTaskId(),
    completed: false,
    createdAt: Date.now(),
  };
  tasks = [task, ...tasks];
  emit();
  return task;
}

export function toggleTask(id: string) {
  tasks = tasks.map((t) =>
    t.id === id ? { ...t, completed: !t.completed } : t,
  );
  emit();
}

export function updateTask(id: string, patch: Partial<Task>) {
  tasks = tasks.map((t) => (t.id === id ? { ...t, ...patch } : t));
  emit();
}

export function removeTask(id: string) {
  tasks = tasks.filter((t) => t.id !== id);
  emit();
}

export function filterTasks(all: Task[], filter: TaskFilter): Task[] {
  switch (filter) {
    case "today":
      return all.filter((t) => t.dueBucket === "today" && !t.completed);
    case "upcoming":
      return all.filter((t) => t.dueBucket === "upcoming" && !t.completed);
    case "urgent":
      return all.filter((t) => t.urgent && !t.completed);
    case "completed":
      return all.filter((t) => t.completed);
    default:
      return all;
  }
}

export function useTasks(): Task[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    () => tasks,
  );
}
