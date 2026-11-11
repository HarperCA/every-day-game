// 新一届：上一届已经结束、按往年时间该有新一届了，库里还没有。只读比赛库，不改任何东西，交回发现的问题。
// 骨架占位，调用时报“还没实现”。说明见同目录 README.md。
//
//   run(ctx) → { problems: [问题] }，问题的写法见 ../../README.md
// 规矩：只用 ctx 给的东西，不 import 别的检查项。
export const meta = { title: '新一届' };

export async function run(ctx) {
  throw new Error('还没实现：维护/审计/新一届');
}
