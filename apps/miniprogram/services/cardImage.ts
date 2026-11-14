// 把画好的转发封面存成文件（2026-11-06）。文件名带内容的校验码：同一个文件名微信会继续用旧图（真机转发时看到过改名之前的封面），内容变了文件名就要变。
// 存好后清掉这张卡片以前的文件，清不掉不影响转发。

function checksum(text: string): string {
  let value = 5381;
  for (let index = 0; index < text.length; index += 1) value = ((value * 33) ^ text.charCodeAt(index)) >>> 0;
  return value.toString(36);
}

function removeOlder(prefix: string, current: string): void {
  try {
    const manager = wx.getFileSystemManager();
    const isOlder = (name: string) => name !== current && (name === `${prefix}.png` || (name.startsWith(`${prefix}-`) && /^[0-9a-z]+\.png$/.test(name.slice(prefix.length + 1))));
    for (const name of manager.readdirSync(wx.env.USER_DATA_PATH).filter(isOlder)) manager.unlinkSync(`${wx.env.USER_DATA_PATH}/${name}`);
  } catch (_error) {
    // 清不掉就留着，下次再清
  }
}

export async function saveCardImage(kind: string, id: string, canvas: { toDataURL(type: string): string }): Promise<string> {
  const data = canvas.toDataURL('image/png').split(',')[1];
  const prefix = `${kind}-${id.replace(/[^\w-]/g, '_')}`;
  const name = `${prefix}-${checksum(data)}.png`;
  const path = `${wx.env.USER_DATA_PATH}/${name}`;
  await new Promise<void>((resolve, reject) => {
    wx.getFileSystemManager().writeFile({ filePath: path, data, encoding: 'base64', success: () => resolve(), fail: reject });
  });
  removeOlder(prefix, name);
  return path;
}
