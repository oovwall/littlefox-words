(() => {
  const status = document.getElementById('auth-status');
  const signIn = document.getElementById('clerk-sign-in');
  const account = document.getElementById('clerk-account');
  const root = document.documentElement;
  const signUpUrl = '/sign-up';
  const signInUrl = '/sign-in';
  const onRoute = (path) => location.pathname === path || location.pathname.startsWith(path + '/');
  const signUpPage = onRoute(signUpUrl);
  const authPage = signUpPage || onRoute(signInUrl);
  let guestStarted = false;
  const loadScript = (src, configure) => new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    if (new URL(src, location.href).origin !== location.origin) script.crossOrigin = 'anonymous';
    configure?.(script);
    script.onload = resolve;
    script.onerror = () => reject(new Error('无法加载登录或词库组件，请检查网络后刷新。'));
    document.head.append(script);
  });
  async function openGuest() {
    if (guestStarted) return;
    guestStarted = true;
    await loadScript('learning.js');
    await loadScript('review.js');
    await loadScript('app.js');
    document.getElementById('guest-login').hidden = false;
    root.dataset.auth = 'ready';
  }

  async function start() {
    const response = await fetch('clerk-config.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('网页版尚未配置 Clerk 登录。');
    const { publishableKey, cloudSync } = await response.json();
    if (!/^pk_(test|live)_[A-Za-z0-9+/=]+$/.test(publishableKey ?? '')) {
      throw new Error('网页版尚未配置有效的 Clerk 登录。');
    }
    const frontend = atob(publishableKey.split('_')[2]);
    if (!/^[a-z0-9-]+(?:\.[a-z0-9-]+)+\$$/i.test(frontend)) throw new Error('Clerk Publishable Key 格式不正确。');
    const cdn = 'https://' + frontend.slice(0, -1) + '/npm/@clerk/';
    await loadScript(cdn + 'ui@1/dist/ui.browser.js');
    await loadScript(cdn + 'clerk-js@6/dist/clerk.browser.js', (script) => {
      script.setAttribute('data-clerk-publishable-key', publishableKey);
    });
    const clerk = window.Clerk;
    const routes = { signInUrl, signUpUrl, signInFallbackRedirectUrl: '/', signUpFallbackRedirectUrl: '/' };
    await clerk.load({ ui: { ClerkUI: window.__internal_ClerkUICtor }, ...routes });

    let mounted = false;
    let activeSession = null;
    const update = async ({ user, session }) => {
      if (user === undefined || session === undefined) return;
      if (activeSession) {
        if (session?.id === activeSession) return;
        root.dataset.auth = 'required';
        document.getElementById('editor').close();
        document.getElementById('practice').close();
        window.Learning?.stopSpeech();
        location.reload();
        return;
      }
      if (!user || !session) {
        if (!authPage) {
          await openGuest();
          return;
        }
        if (!mounted) {
          status.textContent = signUpPage ? '请完成 Clerk 注册验证。' : '登录后打开自己的词库。';
          if (signUpPage) clerk.mountSignUp(signIn, { ...routes, routing: 'path', path: signUpUrl });
          else clerk.mountSignIn(signIn, { ...routes, routing: 'path', path: signInUrl });
          mounted = true;
        }
        return;
      }
      activeSession = session.id;
      if (authPage || guestStarted) {
        location.replace('/');
        return;
      }
      if (mounted) clerk.unmountSignIn(signIn);
      status.textContent = '正在打开你的词库…';
      // Set once before loading any code that reads or writes personal data.
      Object.defineProperty(window, 'wordBlocksAccount', { value: user.id });
      await loadScript('learning.js');
      await loadScript('review.js');
      if (cloudSync) await loadScript('cloud.js');
      await loadScript('app.js');
      if (clerk.session?.id !== activeSession) return;
      clerk.mountUserButton(account);
      root.dataset.auth = 'ready';
    };
    const onChange = (state) => update(state).catch((error) => { status.textContent = error.message; });
    clerk.addListener(onChange, { skipInitialEmit: true });
    await update({ user: clerk.user, session: clerk.session });
  }

  start().catch(async (error) => {
    if (!authPage && !window.wordBlocksAccount) {
      try { await openGuest(); return; } catch { /* Show the loading error below. */ }
    }
    status.textContent = error.message || '登录初始化失败，请刷新重试。';
  });
})();
