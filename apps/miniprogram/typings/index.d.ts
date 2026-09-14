declare namespace WechatMiniprogram {
  interface Input { detail: { value: string } }
  interface PickerChange { detail: { value: string | number } }
  interface TouchEvent { currentTarget: { dataset: Record<string, string> } }
}
declare const wx: any;
declare function App(options: any): void;
declare function Page(options: any): void;
declare function getApp<T = any>(): T;
declare function require(path: string): any;
