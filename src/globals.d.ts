// Ambient browser globals for the client bundle.
//
// The Web client injects `lib/client.js` as a classic script: it has no import
// or export, and the host module table calls `window.__ModuleLoader__.load`.
// This project loads only `@types/node`, so the DOM library is absent and the
// few browser globals the client reads need explicit declarations. Keep them
// narrow: they describe only the members `src/client.ts` touches today, and
// later typing phases widen them as the client code gains real types.

/** Minimal clipboard surface used by the install-spec copy action. */
interface BrowserClipboard {
  writeText(text: string): Promise<void>
}

// Merged into the `Navigator` interface that `@types/node` declares, which
// stops at the Node-side properties and has no `clipboard` member.
interface Navigator {
  readonly clipboard: BrowserClipboard
}

/** The subset of `document` the client reads for visibility gating. */
interface ClientDocument {
  readonly visibilityState: 'visible' | 'hidden' | 'prerender'
  addEventListener(type: 'visibilitychange', listener: () => void): void
  removeEventListener(type: 'visibilitychange', listener: () => void): void
}

/** One bundle entry the host module table evaluates. */
interface ModuleLoaderEntry {
  readonly id: string
  factory(require: (specifier: string) => unknown): unknown
}

interface ModuleLoader {
  load(entry: ModuleLoaderEntry): void
}

/** The browser window plus the host-injected loader. */
interface ClientWindow {
  readonly __ModuleLoader__: ModuleLoader
  addEventListener(type: 'focus', listener: () => void): void
  removeEventListener(type: 'focus', listener: () => void): void
}

declare var window: ClientWindow
declare var document: ClientDocument
