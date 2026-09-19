import type CloudBase from "@cloudbase/manager-node";

type FunctionService = Pick<
  InstanceType<typeof CloudBase>["functions"],
  | "listFunctions"
  | "createFunction"
  | "updateFunctionCode"
  | "updateFunctionConfig"
  | "waitFunctionActive"
  | "getFunctionDetail"
>;
export type FunctionDefinitions = Record<
  string,
  {
    entry: string;
    runtime: string;
    timeout: number;
    memorySize: number;
    handler: string;
  }
>;

/** Apply code and configuration separately, then verify the persisted settings. */
export async function deployFunctions(
  functions: FunctionService,
  definitions: FunctionDefinitions,
  appId: string,
  functionRootPath: string,
): Promise<string[]> {
  if (typeof appId !== "string" || !/^wx[0-9a-f]{16}$/.test(appId))
    throw new Error("部署需要有效的微信小程序 AppID");
  const current = await functions.listFunctions();
  const names = new Set(current.map((f) => f.FunctionName));
  const verified: string[] = [];
  for (const [name, { entry: _entry, ...definition }] of Object.entries(
    definitions,
  )) {
    const func = {
      name,
      ...definition,
      installDependency: true,
      isWaitInstall: true,
      envVariables: { WECHAT_APP_ID: appId } as Record<string, string>,
      ignore: ["node_modules/**"],
    };
    if (names.has(name)) {
      const before = await functions.getFunctionDetail(name);
      // The installed Manager SDK cannot change Runtime via updateFunctionConfig.
      if (before.Runtime !== definition.runtime)
        throw new Error(`${name}: 运行时不匹配，请先制定运行时迁移方案`);
      func.envVariables = {
        ...Object.fromEntries(
          (before.Environment?.Variables || []).map(({ Key, Value }) => [
            Key,
            Value,
          ]),
        ),
        WECHAT_APP_ID: appId,
      };
      await functions.updateFunctionCode({ func, functionRootPath });
      await functions.waitFunctionActive(name);
      await functions.updateFunctionConfig(func);
    } else {
      await functions.createFunction({ func, functionRootPath });
    }
    await functions.waitFunctionActive(name);
    const actual = await functions.getFunctionDetail(name);
    const mismatches: string[] = [];
    if (actual.Runtime !== definition.runtime) mismatches.push("Runtime");
    if (actual.Handler !== definition.handler) mismatches.push("Handler");
    if (actual.Timeout !== definition.timeout) mismatches.push("Timeout");
    if (actual.MemorySize !== definition.memorySize)
      mismatches.push("MemorySize");
    if (actual.Status !== "Active") mismatches.push("Status");
    const variables = actual.Environment?.Variables || [];
    if (!variables.some((v) => v.Key === "WECHAT_APP_ID" && v.Value === appId))
      mismatches.push("WECHAT_APP_ID");
    if (mismatches.length)
      throw new Error(`${name}: 部署后配置核验失败 (${mismatches.join(", ")})`);
    verified.push(name);
  }
  return verified;
}
