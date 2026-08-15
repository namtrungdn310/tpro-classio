import { lazy, Suspense, type ComponentType } from "react";

type Loader = () => Promise<ComponentType<Record<string, unknown>> | { default: ComponentType<Record<string, unknown>> }>;

/** Minimal next/dynamic replacement for e2e harnesses (no Next runtime). */
export default function dynamic(loader: Loader) {
  const Lazy = lazy(() =>
    loader().then((module) => {
      const Component =
        module && typeof module === "object" && "default" in module
          ? module.default
          : (module as ComponentType<Record<string, unknown>>);
      return { default: Component };
    }),
  );
  return function DynamicWrapper(props: Record<string, unknown>) {
    return (
      <Suspense fallback={null}>
        <Lazy {...props} />
      </Suspense>
    );
  };
}
