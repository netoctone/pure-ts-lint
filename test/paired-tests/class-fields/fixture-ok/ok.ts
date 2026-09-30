// @ts-nocheck
export class Component {
  public readonly a = 1;
  private readonly b = 'str';

  public store = inject(Store);
  public c = this.store.selectSignal(getSomeValue);
  public d = signal(1);
  public e = input();
  public f = output();
}
