// Cloudflare Turnstile (antibots). El script se carga en el HTML con ?render=explicit.
interface TurnstileApi {
  render(el: HTMLElement, opts: Record<string, unknown>): string;
  getResponse(id: string): string | undefined;
  reset(id: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

function whenReady(): Promise<TurnstileApi> {
  return new Promise((resolve) => {
    const check = () => (window.turnstile ? resolve(window.turnstile) : setTimeout(check, 150));
    check();
  });
}

export interface Widget {
  token(): string;
  reset(): void;
}

export async function mountTurnstile(el: HTMLElement, sitekey: string): Promise<Widget> {
  const ts = await whenReady();
  const id = ts.render(el, { sitekey, language: "es", theme: "light" });
  return {
    token: () => ts.getResponse(id) ?? "",
    reset: () => ts.reset(id),
  };
}
