import { WebSocket, MessageEvent, ClientOptions } from "ws";

const LOG_LEVEL: string | null = process.env.MODELSOCKET_LOG || null;

const LevelLogger = {
  debug: (...args: any[]) => {
    if (LOG_LEVEL === "debug") {
      console.debug("[debug][ms] ", ...args);
    }
  },
  info: (...args: any[]) => {
    if (LOG_LEVEL === "debug" || LOG_LEVEL === "info") {
      console.info(`[${LOG_LEVEL}][ms] `, ...args);
    }
  },
  error: (...args: any[]) => {
    if (
      LOG_LEVEL === "debug" ||
      LOG_LEVEL === "info" ||
      LOG_LEVEL === "error"
    ) {
      console.error(`[${LOG_LEVEL}][ms] `, ...args);
    }
  },
};

const NullLogger = {
  debug: () => {},
  info: () => {},
  error: () => {},
};

const Logger = (() => {
  if (LOG_LEVEL !== null) {
    return LevelLogger;
  }

  return NullLogger;
})();

interface OpenOptions {
  tools?: boolean;
  toolPrompt?: string;
  skipPrelude?: boolean;
}

// FIXME replace with uuid or something
var cid_counter = 0;

function get_cid() {
  return `cid_${cid_counter++}`;
}

export class ModelSocket {
  // underlying websocket transport
  private socket: WebSocket;

  // map of [cid,seq resolve fns] that are waiting for an open event
  private openingSeqs: Map<
    string,
    [(seqId: string) => void, (error: any) => void]
  > = new Map();

  // seqs managed by this socket
  private seqs: Map<string, Seq> = new Map();

  private constructor(socket: WebSocket) {
    this.socket = socket;
    this.socket.onmessage = this.onMessage.bind(this);
  }

  static async connect(url: string, opts?: ClientOptions) {
    const apiKey = process?.env?.MODELSOCKET_API_KEY;
    let wsOpts = opts || {};

    if (apiKey) {
      wsOpts = {
        ...opts,
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      };
    }

    const socket = new WebSocket(url, wsOpts);

    let p = new Promise<ModelSocket>((resolve, reject) => {
      socket.onopen = () => {
        Logger.debug("conn open");
        resolve(new ModelSocket(socket));
      };

      socket.onerror = (err) => {
        Logger.error("conn error ", err);
        reject(err);
      };
    });

    return p;
  }

  protected onMessage(msg: MessageEvent) {
    Logger.debug("<- ", msg.data);

    if (typeof msg.data !== "string") {
      Logger.error("ms protocol error: message.data is not a string");
      return;
    }

    try {
      const event: Event = JSON.parse(msg.data);
      switch (event.event) {
        case EventType.SEQ_OPENED:
          this.onSeqOpened(event);
          break;
        case EventType.SEQ_APPEND_FINISHED:
          this.onSeqAppendFinished(event);
          break;
        case EventType.SEQ_GEN_FINISHED:
          this.onSeqGenFinished(event);
          break;
        case EventType.SEQ_TEXT:
          this.onSeqText(event);
          break;
        case EventType.SEQ_CLOSED:
          this.onSeqClosed(event);
          break;
        case EventType.SEQ_FORK_FINISHED:
          this.onSeqForkFinished(event);
          break;

        case EventType.SEQ_TOOL_CALL:
          this.onSeqToolCall(event);
          break;

        case EventType.ERROR:
          this.onError(event);
          break;
        default:
          Logger.error("unknown socket event ", event);
          break;
      }
    } catch (e) {
      console.error(e);
    }
  }

  protected onSeqToolCall(event: Event) {
    if (!event.seq_id) {
      throw new Error("recv error: seq_id is required");
    }

    const seq = this.seqs.get(event.seq_id!);

    if (seq) {
      seq.onToolCall(event);
    } else {
      throw new Error(`state error: unknown seq_id ${event.seq_id}`);
    }
  }

  protected onError(event: Event) {
    Logger.error("error ", event);

    if (event.cid && this.openingSeqs.has(event.cid)) {
      const [, reject] = this.openingSeqs.get(event.cid)!;
      reject(new Error(`open error: ${event.message}`));
    }
  }

  protected onSeqClosed(event: Event) {
    if (!event.seq_id) {
      throw new Error("recv error: seq_id is required");
    }

    const seq = this.seqs.get(event.seq_id!);

    if (seq) {
      seq.onClose(event);
    } else {
      throw new Error(`state error: unknown seq_id ${event.seq_id}`);
    }
  }

  protected onSeqOpened(event: Event) {
    const seqResolvePair = this.openingSeqs.get(event.cid);

    if (seqResolvePair) {
      this.openingSeqs.delete(event.cid);

      const [seqResolve, seqReject] = seqResolvePair;

      if (event.seq_id) {
        seqResolve(event.seq_id);
      } else {
        seqReject(new Error("ms protocol recv error: seq_id is required"));
      }
    } else {
      console.error("unknown opened seq_id ", event.seq_id);
    }
  }

  protected onSeqGenFinished(event: Event) {
    if (!event.seq_id) {
      throw new Error("recv error: seq_id is required");
    }

    const seq = this.seqs.get(event.seq_id!);

    if (seq) {
      seq.onGenFinished(event);
    } else {
      throw new Error(`state error: unknown seq_id ${event.seq_id}`);
    }
  }

  protected onSeqAppendFinished(event: Event) {
    if (!event.seq_id) {
      throw new Error("recv error: seq_id is required");
    }

    const seq = this.seqs.get(event.seq_id!);

    if (seq) {
      seq.onAppendFinished(event);
    } else {
      throw new Error(`state error: unknown seq_id ${event.seq_id}`);
    }
  }

  protected onSeqForkFinished(event: Event) {
    if (!event.seq_id) {
      throw new Error("recv error: seq_id is required");
    }

    const seq = this.seqs.get(event.seq_id!);

    if (seq) {
      seq.onForkFinished(event);
    } else {
      throw new Error(`state error: unknown seq_id ${event.seq_id}`);
    }
  }

  registerSeq(seq: Seq) {
    this.seqs.set(seq.getId(), seq);
  }

  protected onSeqText(event: Event) {
    if (!event.seq_id) {
      throw new Error("recv error: seq_id is required");
    }

    const seq = this.seqs.get(event.seq_id);

    if (seq) {
      seq.onText(event);
    } else {
      throw new Error(`state error: unknown seq_id ${event.seq_id}`);
    }
  }

  send(req: Request) {
    Logger.debug("-> ", req);
    this.socket.send(JSON.stringify(req));
  }

  async open(model: string, opts?: OpenOptions): Promise<Seq> {
    const cid = get_cid();
    const seqPromise = new Promise<string>((resolve, reject) => {
      this.openingSeqs.set(cid, [resolve, reject]);
    });

    this.send({
      cid,
      request: ReqType.SEQ_OPEN,
      data: {
        model,
        //convert opts to snake case
        tools_enabled: opts?.tools,
        tool_prompt: opts?.toolPrompt,
        skip_prelude: opts?.skipPrelude,
      },
    });

    const seqId = await seqPromise;
    const seq = new Seq(seqId, model, this, opts?.tools || false);
    this.seqs.set(seqId, seq);

    return seq;
  }

  close() {
    this.socket.close();
    this.seqs.forEach((seq) => {
      seq.onClose();
    });
    this.openingSeqs.forEach(([, reject]) => {
      reject(new Error("websocket closed by client"));
    });
    this.openingSeqs.clear();
    this.seqs.clear();
  }
}

interface GenOptions {
  role?: string;
  tokens?: boolean;
  temperature?: number;
}

interface AppendOptions {
  role?: string;
  hidden?: boolean;
}

class Seq {
  private seqId: string;
  private model: string;
  private socket: ModelSocket;
  private genStreams: Map<string, WritableStream<GenChunk>> = new Map();

  // stores the last generation options so we can resume after a toolc all
  private curGenOpts: GenOptions | null = null;

  readonly toolsEnabled: boolean;
  readonly tools: ToolDefinitions;

  // map of open commands
  private cmds: Map<string, [(v: any) => void, (error: any) => void]> =
    new Map();

  constructor(
    seqId: string,
    model: string,
    socket: ModelSocket,
    toolsEnabled: boolean,
    toolDefs?: ToolDefinitions
  ) {
    this.seqId = seqId;
    this.model = model;
    this.socket = socket;
    this.toolsEnabled = toolsEnabled;
    this.tools = toolDefs || {};
  }

  getModel(): string {
    return this.model;
  }

  getId(): string {
    return this.seqId;
  }

  onClose(event?: Event) {
    if (event && event.cid) {
      const p = this.cmds.get(event.cid);

      if (p) {
        this.cmds.delete(event.cid);
        const [resolve] = p;
        resolve(null);
      }
    }

    this.cmds.forEach(([, reject]) => {
      reject(new Error("seq closed"));
    });

    this.cmds.clear();
  }

  onText(event: Event) {
    const cid = event.cid;
    const writable = this.genStreams.get(cid);

    // if we have a stream for this cid, write the text to it. we may not always have a
    // stream (e.g. if we're appending)
    if (writable) {
      let chunk: GenChunk = {
        text: event.text || "",
        tokens: event.tokens,
        hidden: event.hidden,
      };

      let writer = writable.getWriter();

      //TODO should we just store the writer instead of reacquiring it every time?
      writer.write(chunk);
      writer.releaseLock();
    }
  }

  onGenFinished(event: Event) {
    const cid = event.cid;
    const [resolve] = this.cmds.get(cid)!;
    this.cmds.delete(cid);

    let genStream = this.genStreams.get(cid);

    this.genStreams.delete(cid);
    if (genStream) {
      genStream.getWriter().close();
    } else {
      Logger.error("onGenFinished: unknown stream cid ", cid);
    }

    this.curGenOpts = null;

    resolve(null);
  }

  // seq level event handler
  onAppendFinished(event: Event) {
    const cid = event.cid;

    if (this.cmds.has(cid)) {
      const [resolve] = this.cmds.get(cid)!;
      this.cmds.delete(cid);
      resolve(null);
    }
  }

  onForkFinished(event: Event) {
    const cid = event.cid;
    const [resolve, reject] = this.cmds.get(cid)!;
    this.cmds.delete(cid);

    if (!event.child_seq_id) {
      reject(new Error("recv error: childSeqId missing from server"));
    }

    let childSeq = new Seq(
      event.child_seq_id!,
      this.model,
      this.socket,
      this.toolsEnabled,
      this.tools
    );

    this.socket.registerSeq(childSeq);

    resolve(childSeq);
  }

  onToolCall(event: Event) {
    if (!event.tool_calls) {
      throw new Error("recv error: tool_calls is required");
    }

    (async () => {
      let results: ToolResult[] = [];

      for (const toolCall of event.tool_calls!) {
        let args;

        // try to parse the args as json, if it fails, pass the args as a string
        try {
          args = JSON.parse(toolCall.args);
        } catch (e) {
          args = toolCall.args;
        }

        // sequential tool invocation, allow concurrent in the future
        try {
          let toolResult = await this.invokeTool(toolCall.name, args);

          results.push({
            name: toolCall.name,
            result: JSON.stringify(toolResult),
          });
        } catch (e) {
          Logger.error(`error invoking tool ${toolCall.name}`, e);
        }
      }

      this.socket.send({
        request: ReqType.SEQ_COMMAND,
        seq_id: this.seqId,
        cid: event.cid,
        data: {
          command: SeqCommandType.TOOL_RETURN,
          gen_opts: this.curGenOpts,
          results,
        },
      });
    })();
  }

  async invokeTool(name: string, params: any): Promise<any> {
    let tool = this.tools[name];

    if (!tool) {
      throw new Error(`Tool ${name} not found`);
    }

    return await Promise.resolve(tool.fn(params));
  }

  async close() {
    const cid = get_cid();

    const p = new Promise<any>((resolve, reject) => {
      this.cmds.set(cid, [resolve, reject]);
    });

    this.socket.send({
      request: ReqType.SEQ_COMMAND,
      seq_id: this.seqId,
      cid,
      data: {
        command: SeqCommandType.SEQ_CLOSE,
      },
    });

    await p;
  }

  async append(tokensArg: string | Array<number>, opts?: AppendOptions) {
    const cid = get_cid();

    const p = new Promise<any>((resolve, reject) => {
      this.cmds.set(cid, [resolve, reject]);
    });

    let text = undefined;
    let tokens = undefined;

    if (typeof tokensArg === "string") {
      text = tokensArg;
    } else {
      tokens = tokensArg;
    }

    try {
      this.socket.send({
        request: ReqType.SEQ_COMMAND,
        seq_id: this.seqId,
        cid,
        data: {
          command: SeqCommandType.SEQ_APPEND,
          text,
          tokens,
          ...opts,
        },
      });
    } catch (e) {
      Logger.error("append error: ", e);
      let [, reject] = this.cmds.get(cid)!;
      this.cmds.delete(cid);
      reject(e);
    }

    await p;
  }

  gen(opts?: GenOptions): GenStream {
    const cid = get_cid();

    const p = new Promise<any>((resolve, reject) => {
      this.cmds.set(cid, [resolve, reject]);
    });

    const { readable, writable } = new TransformStream<GenChunk, GenChunk>();

    this.genStreams.set(cid, writable);
    this.curGenOpts = opts ?? null;

    this.socket.send({
      request: ReqType.SEQ_COMMAND,
      seq_id: this.seqId,
      cid,
      data: {
        command: SeqCommandType.SEQ_GEN,
        ...opts,
      },
    });

    return new GenStream(readable);
  }

  async createFork(): Promise<Seq> {
    const cid = get_cid();

    const p = new Promise<any>((resolve, reject) => {
      this.cmds.set(cid, [resolve, reject]);
    });

    this.socket.send({
      request: ReqType.SEQ_COMMAND,
      seq_id: this.seqId,
      cid,
      data: {
        command: SeqCommandType.SEQ_FORK,
      },
    });

    return await p;
  }

  async withFork<T>(fn: (childSeq: Seq) => Promise<T>): Promise<T> {
    const childSeq = await this.createFork();
    try {
      return await fn(childSeq);
    } finally {
      childSeq.close().catch((err: any) => {
        Logger.error("error closing child seq", err);
      });
    }
  }

  async install(tool: Tool): Promise<void> {
    if (!this.toolsEnabled) {
      throw new Error(
        "Tools are not enabled for this seq, call `open` with `{ tools: true }`"
      );
    }

    validateTool(tool);

    if (this.tools[tool.name]) {
      throw new Error(`Tool with name ${tool.name} already exists`);
    }

    // TODO allow customization of individual tool prompt
    await this.append(
      `Use the function '${tool.name}' to: ${tool.description}\n` +
        JSON.stringify(
          {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
          },
          null,
          2
        ) +
        "\n\n",
      { role: "system", hidden: true }
    );

    this.tools[tool.name] = tool;
  }
}

function validateTool(tool: Tool) {
  if (!tool.name) {
    throw new Error("Tool must have a name");
  }

  if (typeof tool.name !== "string") {
    throw new Error("Tool name must be a string");
  }

  if (!tool.name.match(/^[a-zA-Z0-9_]+$/)) {
    throw new Error(
      `Tool name ${tool.name} is not valid, only alphanumeric and underscores allowed.`
    );
  }

  if (!tool.description) {
    throw new Error("Tool must have a description");
  }

  if (typeof tool.description !== "string") {
    throw new Error("Tool description must be a string");
  }

  if (!tool.fn) {
    throw new Error("Tool must have a function (fn)");
  }

  if (typeof tool.fn !== "function") {
    throw new Error("Tool.fn must be a function");
  }

  if (tool.parameters && typeof tool.parameters !== "object") {
    throw new Error("Tool.parameters must be an object");
  }
}

enum ReqType {
  SEQ_OPEN = "seq_open",
  SEQ_COMMAND = "seq_command",
}

enum SeqCommandType {
  SEQ_CLOSE = "close",
  SEQ_APPEND = "append",
  SEQ_GEN = "gen",
  SEQ_FORK = "fork",
  TOOL_RETURN = "tool_return",
}

interface Request {
  cid: string;
  request: ReqType;
  seq_id?: string;
  data: any;
}

enum EventType {
  SEQ_OPENED = "seq_opened",
  SEQ_CLOSED = "seq_closed",
  SEQ_TEXT = "seq_text",
  SEQ_APPEND_FINISHED = "seq_append_finish",
  SEQ_GEN_FINISHED = "seq_gen_finish",
  SEQ_FORK_FINISHED = "seq_fork_finish",
  SEQ_TOOL_CALL = "seq_tool_call",
  ERROR = "error",
}

interface Event {
  cid: string;
  event: string;
  seq_id?: string;
  text?: string;
  tokens?: number[];
  hidden?: boolean;
  message?: string;
  child_seq_id?: string;
  tool_calls?: ToolCall[];
}

export interface ToolCall {
  name: string;
  args: string;
}

export interface GenChunk {
  text: string;
  hidden?: boolean;
  tokens?: number[];
}

export class GenStream {
  private readable: ReadableStream<GenChunk>;

  constructor(readable: ReadableStream<GenChunk>) {
    this.readable = readable;
  }

  /**
   * Returns the underlying ReadableStream.
   */
  stream(): ReadableStream<GenChunk> {
    return this.readable;
  }

  textStream(): ReadableStream<string> {
    const stream = this.stream();

    const xform = new TransformStream<GenChunk, string>({
      start() {},
      async transform(chunk, controller) {
        if (!chunk.hidden) {
          controller.enqueue(chunk.text);
        }
      },
    });

    stream.pipeTo(xform.writable);

    return xform.readable;
  }

  /**
   * Reads the entire stream and returns the full text content.
   */
  async text(): Promise<string> {
    const stream = this.readable;
    const reader = stream.getReader();

    let result = "";
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      if (!value.hidden) {
        result += value.text;
      }
    }

    return result;
  }

  /**
   * Reads the entire stream and returns the full text content.
   */
  async textAndTokens(): Promise<{ text: string; tokens: number[] }> {
    const stream = this.readable;
    const reader = stream.getReader();

    let result: { text: string; tokens: number[] } = { text: "", tokens: [] };

    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      if (!value.hidden) {
        result.text += value.text;

        if (value.tokens) {
          result.tokens.push(...value.tokens);
        }
      }
    }

    return result;
  }
}

export interface Tool {
  name: string;
  description: string;
  fn: (params: any) => Promise<any> | any;
  parameters?: Record<string, any>;
}

interface ToolResult {
  name: string;
  result: any;
}

interface ToolDefinitions {
  [key: string]: Tool;
}
