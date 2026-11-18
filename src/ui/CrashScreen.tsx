import { Component, Fragment, createRef, type ErrorInfo, type ReactNode } from 'react';
import { downloadText, noteCrash, savedProjectList, savedProjectText } from '../store';
import './crash.css';

/** Around the whole app. If drawing the page fails anywhere that no smaller Boundary caught, this stands in for the
 *  white page: what happened, that nothing saved was deleted, and three ways on (download everything, the start
 *  screen, reload). It reads only the list of saved projects and their saved text, never the open project, so it
 *  draws even when the open project is what failed. The error goes to the console and into Details; nowhere else. */
interface State { error: unknown; where: string; was: { id: string | null; name: string } | null; round: number; busy: boolean; said: string }

export class AppBoundary extends Component<{ children: ReactNode; reload?: () => void }, State> {
  state: State = { error: null, where: '', was: null, round: 0, busy: false, said: '' };
  private heading = createRef<HTMLHeadingElement>();

  static getDerivedStateFromError(error: unknown): Partial<State> { return { error: error ?? new Error('Unknown error') }; }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('ProfitShare could not draw the page', error, info.componentStack);
    let was: State['was'] = null;
    try { was = noteCrash(); } catch (e) { console.error(e); }   // remembers which project was open, so a reload does not open it again by itself
    this.setState({ was, where: info.componentStack ?? '' });
  }
  // focus goes to the screen's heading, so the next Tab lands on its buttons (the page that had focus is gone)
  componentDidMount() { if (this.state.error) this.heading.current?.focus(); }
  componentDidUpdate(_: unknown, prev: State) { if (this.state.error && !prev.error) this.heading.current?.focus(); }

  /** Back to the app with no project open: the app is drawn again from nothing and, since a crash was noted, starts on the start screen. */
  private toStart = () => this.setState(s => ({ error: null, where: '', was: null, said: '', round: s.round + 1 }));
  private reload = () => (this.props.reload ?? (() => window.location.reload()))();
  private download = async (only?: string) => {
    this.setState({ busy: true, said: '' });
    let n = 0;
    try {
      for (const p of safeList()) {
        if (only && p.id !== only) continue;
        const text = await savedProjectText(p.id);
        if (text === null) continue;
        downloadText(text, p.fileName); n++;
        if (!only) await new Promise(r => setTimeout(r, 250));   // one at a time, so the browser takes each file
      }
      this.setState({ busy: false, said: n === 0 ? 'There was nothing to download.' : n === 1 ? '1 project file downloaded. Look in your Downloads folder.' : `${n} project files downloaded. Look in your Downloads folder. If the browser asked whether to allow several downloads, choose Allow.` });
    } catch (e) {
      console.error('A saved project could not be downloaded', e);
      this.setState({ busy: false, said: 'The download did not go through. Try the button beside each project below.' });
    }
  };

  render() {
    const { error, where, was, busy, said } = this.state;
    if (!error) return <Fragment key={this.state.round}>{this.props.children}</Fragment>;   // a new round draws the app again from nothing
    const saved = safeList();
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    const stack = error instanceof Error && error.stack ? error.stack.split('\n').slice(1, 6).join('\n') : '';
    return (
      <div className="app crash">
        <header className="top empty"><h1>ProfitShare</h1></header>
        <hr className="rule" aria-hidden="true" />
        <main>
          <div className="panel" role="alert">
            <h2 ref={this.heading} tabIndex={-1}>This page could not be shown</h2>
            <p>ProfitShare ran into a problem while drawing {was?.name ? <>“{was.name}”</> : 'the page'} and had to stop. <b>The projects saved in this browser have not been deleted.</b></p>
            <p className="help">You can download a copy of every saved project to be safe, go back to the start screen, or reload. {was?.id ? 'The project that was open stays under Projects; it will not be opened again until you open it yourself.' : ''}</p>
            <div className="row crash-actions">
              <button type="button" className="btn primary" disabled={busy || saved.length === 0} onClick={() => void this.download()}>Download every saved project</button>
              <button type="button" className="btn" onClick={this.toStart}>Go to the start screen</button>
              <button type="button" className="btn" onClick={this.reload}>Reload</button>
            </div>
            <p className="crash-said" role="status" aria-live="polite">{said}</p>
            {saved.length > 0 ? (
              <table className="crash-list">
                <caption>Saved in this browser</caption>
                <tbody>
                  {saved.map(p => (
                    <tr key={p.id}>
                      <td>{p.name || 'Untitled'}{was?.id === p.id ? <span className="muted"> (was open)</span> : null}</td>
                      <td><button type="button" className="btn small" disabled={busy} aria-label={`Download ${p.name || 'Untitled'}`} onClick={() => void this.download(p.id)}>Download</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <p className="help">No projects are saved in this browser yet.</p>}
            <details className="crash-details">
              <summary>Details</summary>
              <p className="help">If you report this, these lines help. They stay on this page unless you copy them.</p>
              <pre>{message}{stack ? `\n${stack}` : ''}{where ? `\n${where.trim().split('\n').slice(0, 4).join('\n')}` : ''}</pre>
            </details>
          </div>
        </main>
      </div>
    );
  }
}

/** The saved projects, or none if even the list cannot be read: this screen must draw whatever the browser holds. */
function safeList(): ReturnType<typeof savedProjectList> {
  try { return savedProjectList(); } catch (e) { console.error(e); return []; }
}
