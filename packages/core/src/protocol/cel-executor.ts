export interface CompiledScript {
  execute(contextData: Record<string, any>): any;
  executeRaw(contextData: Record<string, any>): any;
  executeRawWithDiagnostics(contextData: Record<string, any>): { result: any; error?: string };
  executeWithDiagnostics(contextData: Record<string, any>): { result: any; error?: string };
}

export class ReusableBufferView {
  public proxy: any;
  constructor() { this.proxy = {}; }
  public update() {}
}

export class CelExecutor {
  private static sharedInstance?: CelExecutor;
  public static shared(): CelExecutor {
    if (!CelExecutor.sharedInstance) CelExecutor.sharedInstance = new CelExecutor();
    return CelExecutor.sharedInstance;
  }
  public createReusableBufferView() { return new ReusableBufferView(); }
  public prepare(script: string): CompiledScript {
    return {
      execute: () => null,
      executeRaw: () => null,
      executeRawWithDiagnostics: () => ({ result: null }),
      executeWithDiagnostics: () => ({ result: null })
    };
  }
  public execute() { return null; }
  public executeWithDiagnostics() { return { result: null }; }
  public registerFunction() {}
}
