/** One snapshot per edit, or per complete pointer gesture. View state is separate. */
export class History<T> {
  private past: T[] = [];
  private future: T[] = [];
  get canUndo(): boolean {
    return this.past.length > 0;
  }
  get canRedo(): boolean {
    return this.future.length > 0;
  }

  commit(before: T, after: T): void {
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    this.past.push(structuredClone(before));
    if (this.past.length > 100) this.past.shift();
    this.future = [];
  }
  undo(current: T): T {
    const previous = this.past.pop();
    if (previous === undefined) return current;
    this.future.push(structuredClone(current));
    return previous;
  }
  redo(current: T): T {
    const next = this.future.pop();
    if (next === undefined) return current;
    this.past.push(structuredClone(current));
    return next;
  }
}
