import { MessageEvent } from "ws";
interface OpenOptions {
    tools?: boolean;
    toolPrompt?: string;
    skipPrelude?: boolean;
}
export declare class ModelSocket {
    private socket;
    private openingSeqs;
    private seqs;
    private constructor();
    static connect(url: string): Promise<ModelSocket>;
    protected onMessage(msg: MessageEvent): void;
    protected onSeqToolCall(event: Event): void;
    protected onError(event: Event): void;
    protected onSeqClosed(event: Event): void;
    protected onSeqOpened(event: Event): void;
    protected onSeqGenFinished(event: Event): void;
    protected onSeqAppendFinished(event: Event): void;
    protected onSeqForkFinished(event: Event): void;
    registerSeq(seq: Seq): void;
    protected onSeqText(event: Event): void;
    send(req: Request): void;
    open(model: string, opts?: OpenOptions): Promise<Seq>;
    close(): void;
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
declare class Seq {
    private seqId;
    private model;
    private socket;
    private genStreams;
    private curGenOpts;
    readonly toolsEnabled: boolean;
    readonly tools: ToolDefinitions;
    private cmds;
    constructor(seqId: string, model: string, socket: ModelSocket, toolsEnabled: boolean, toolDefs?: ToolDefinitions);
    getModel(): string;
    getId(): string;
    onClose(event?: Event): void;
    onText(event: Event): void;
    onGenFinished(event: Event): void;
    onAppendFinished(event: Event): void;
    onForkFinished(event: Event): void;
    onToolCall(event: Event): void;
    invokeTool(name: string, params: any): Promise<any>;
    close(): Promise<void>;
    append(tokensArg: string | Array<number>, opts?: AppendOptions): Promise<void>;
    gen(opts?: GenOptions): GenStream;
    createFork(): Promise<Seq>;
    withFork<T>(fn: (childSeq: Seq) => Promise<T>): Promise<T>;
    install(tool: Tool): Promise<void>;
}
declare enum ReqType {
    SEQ_OPEN = "seq_open",
    SEQ_COMMAND = "seq_command"
}
interface Request {
    cid: string;
    request: ReqType;
    seq_id?: string;
    data: any;
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
export declare class GenStream {
    private readable;
    constructor(readable: ReadableStream<GenChunk>);
    /**
     * Returns the underlying ReadableStream.
     */
    stream(): ReadableStream<GenChunk>;
    textStream(): ReadableStream<string>;
    /**
     * Reads the entire stream and returns the full text content.
     */
    text(): Promise<string>;
    /**
     * Reads the entire stream and returns the full text content.
     */
    textAndTokens(): Promise<{
        text: string;
        tokens: number[];
    }>;
}
export interface Tool {
    name: string;
    description: string;
    fn: (params: any) => Promise<any> | any;
    parameters?: Record<string, any>;
}
interface ToolDefinitions {
    [key: string]: Tool;
}
export {};
