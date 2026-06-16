import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";

export type Theme = "dark" | "light";

const STORAGE_KEY = "mini-sentry-theme";

/** Resolve the initial theme the same way the inline boot script in index.html
 *  does: explicit stored choice first, otherwise the OS preference. Keeping the
 *  two in sync avoids a flash of the wrong theme on first paint. */
const getInitialTheme = (): Theme => {
  if (typeof localStorage !== "undefined") {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "dark" || stored === "light") {
      return stored;
    }
  }
  if (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  ) {
    return "dark";
  }
  return "light";
};

const applyTheme = (theme: Theme): void => {
  document.documentElement.classList.toggle("dark", theme === "dark");
};

interface ThemeState {
  theme: Theme;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeState | null>(null);

export const ThemeProvider = ({ children }: { children: ReactNode }): ReactNode => {
  const [theme, setTheme] = useState<Theme>(getInitialTheme);

  // Keep the DOM in sync with React state. Idempotent vs the index.html boot
  // script (toggle(force) never removes-then-re-adds), so it never flashes.
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const value = useMemo<ThemeState>(
    () => ({
      theme,
      toggle: () => {
        setTheme((prev) => {
          const next = prev === "dark" ? "light" : "dark";
          // Persist only on an explicit choice so a later change to the OS
          // preference is still honoured for users who never toggled.
          localStorage.setItem(STORAGE_KEY, next);
          return next;
        });
      }
    }),
    [theme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export const useTheme = (): ThemeState => {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return ctx;
};

export const ThemeToggle = (): ReactNode => {
  const { theme, toggle } = useTheme();
  const label = theme === "dark" ? "라이트 모드로 전환" : "다크 모드로 전환";
  return (
    <button
      type="button"
      className="ghost theme-toggle"
      onClick={toggle}
      aria-label={label}
      title={label}
    >
      {theme === "dark" ? "☀️" : "🌙"}
    </button>
  );
};
