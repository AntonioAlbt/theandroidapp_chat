import { Server } from "bun";

const authToken = "dh287h187h328";
const timeoutSecs = 10;

interface Message {
    id: number;
    uid: number;
    name: string;
    content: string;
}

// warning: api parameter can be used to access any file on the system lol

async function getMessages(api: number) {
    const file = Bun.file("messages/" + api + ".json")
    if (!await file.exists()) {
        await Bun.write(file, "[]")
        return []
    }
    return await file.json() as Message[]
}

async function writeMessages(api: number, messages: Message[]) {
    const file = Bun.file("messages/" + api + ".json")
    await Bun.write(file, JSON.stringify(messages))
}

async function addMessage(api: number, message: Message) {
    const msgs = await getMessages(api)
    msgs.push(message)
    await writeMessages(api, msgs)
}

function wsres(action: string, data: any) {
    return JSON.stringify({happening: action, ...data})
}

function wserr(error: any) {
    return wsres("error", {error})
}

const server = Bun.serve({
    fetch: async function (this: Server, request: Request, server: Server) {
        const url = new URL(request.url)
        console.log("new connection")
        if (url.searchParams.get("auth") == authToken) {
            if (url.pathname == "/get") {
                try {
                    return new Response(await Bun.file("messages/" + url.searchParams.get("api") + ".json").text(), {headers:{"content-type":"application/json"}})
                } catch {
                    return new Response("error", { status: 500 })
                }
            }
            if (server.upgrade(request)) {
                return;
            }
        } else if (url.pathname == "/" || url.pathname == "/chat") {
            return new Response(await Bun.file("chat.html").text(), {headers: {"content-type": "text/html"}})
        } else if (url.pathname == "/favicon.ico") {
            return new Response("not found", { status: 404 });
        }
        return new Response("", { status: 401 });
    },
    websocket: {
        async message(ws, message) {
            if (typeof message != "string") return ws.close(1001)
            let data;
            try {
                data = JSON.parse(message)
            } catch {
                ws.close(1001)
                return
            }
            switch (data.action) {
                case "auth":
                    if ((ws.data as any).uid) {
                        ws.sendText(wserr("already authed"))
                        return
                    }
                    try {
                        ws.data = {
                            ...ws.data as any,
                            name: data.name,
                            api: data.api,
                            uid: data.uid ?? Math.round(Math.random() * 1000000 + 1),
                        }
                        ws.subscribe("chat-" + data.api)
                        ws.sendText(wsres("auth", {success: true, uid: (ws.data as any).uid}))
                    } catch {
                        ws.close(1001)
                    }
                    break;
                
                case "send":
                    if (!(ws.data as any).uid) {
                        ws.close(1001)
                        return
                    }
                    const message = {
                        id: Math.round(Math.random() * 1000000 + 1),
                        name: (ws.data as any).name,
                        content: data.content,
                        uid: (ws.data as any).uid,
                    }
                    try {
                        await addMessage((ws.data as any).api, message)
                    } catch (e) {
                        console.error(e)
                        ws.sendText(wserr("save error"))
                        break;
                    }
                    server.publish("chat-" + (ws.data as any).api, wsres("new-message", message))
                    break;
                
                case "get":
                    if (!(ws.data as any).uid) {
                        ws.close(1001)
                        return
                    }
                    ws.sendText(wsres("get", {data: await getMessages((ws.data as any).api)}))
                    break;
                
                case "alive":
                    clearTimeout((ws.data as any).timeout);
                    (ws.data as any).timeout = setTimeout(() => {
                        console.log("websocket timeout");
                        ws.close(1013);
                        return;
                    }, timeoutSecs * 1000)
                    ws.sendText(wsres("alive", {"success":true}))
                    break;
            
                default:
                    ws.close(1001)
                    break;
            }
        },
        open(ws) {
            ws.data = {
                timeout: setTimeout(() => {
                    console.log("websocket timeout");
                    ws.close(1013);
                    return;
                }, timeoutSecs * 1000)
            }
        },
        close(ws, code, reason) {
            console.log("websocket closed", code, reason)
            clearTimeout((ws.data as any).timeout)
        },
    },
})

console.log(`Listening on ${server.hostname}:${server.port}`)
