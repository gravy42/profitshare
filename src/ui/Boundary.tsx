import { Component, type ReactNode } from 'react';

/** Keeps one part of the page from taking the rest down: if drawing it fails (a project file with something in it this
 *  version cannot read), a plain message stands in its place, with a way to try again. */
export class Boundary extends Component<{ what: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.error(`${this.props.what} could not be shown`, error);
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="notice bad" role="alert">
        <b>{this.props.what} could not be shown.</b> Something in this project is not in a form this version of
        ProfitShare can read. Everything else on the page still works, and nothing has been changed or lost: press Save
        to keep a copy of the project file.{' '}
        <button type="button" className="btn small" onClick={() => this.setState({ failed: false })}>
          Try again
        </button>
      </div>
    );
  }
}
