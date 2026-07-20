import http from "http";
import os from "os";
import fs from "fs/promises";

import OpenAI from "openai";

let openai;

const corsHeaders = {
    "Access-Control-Allow-Origin": "https://janitorai.com",
    "Access-Control-Allow-Headers": "Authorization, Content-Type"
};

http.createServer((req, res) => {
    if (req.method === "OPTIONS") {
        res.writeHead(204, corsHeaders);
        res.end();
        return;
    }

    const apiKey = req.headers["authorization"].split(" ")[1];

    if (apiKey !== openai?.apiKey) {
        openai = new OpenAI({
            apiKey,
            baseURL: "http://127.0.0.1:6970/v1/",
            maxRetries: 0
        });
    }

    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", async () => {
        const payload = JSON.parse(body);

        let system = payload.messages[0].content; 
        let name = system.slice(2, system.indexOf("'s Persona>"));

        // payload.messages[0].content = system; // you can edit the character definition directly instead of trying to prompt around it

        name += ` (${system.length})`;
        const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

        const preset = {
            identifier: `@local:${slug}`,
            name: name,
            changed: true,
            operation: {
                fields: [{
                    key: "llm.prediction.systemPrompt",
                    value: system.replace(/<UserPersona>.*?<\/UserPersona>\n/s, "")
                }]
            },
            load: {
                fields: []
            }
        };

        const path = `${os.homedir()}\\.lmstudio\\config-presets\\${slug}.preset.json`;

        try {
            await fs.access(path);
        } catch {
            await fs.writeFile(path, JSON.stringify(preset, null, 2));
        }

        let stream;

        while (!stream) {
            try {
                stream = await openai.chat.completions.create({
                    ...payload,
                    reasoning_effort: "minimal" // janitor doesn't expose a reasoning_effort setting
                });
            } catch(e) {
                console.error(e);

                if (e.status && e.status < 500) {
                    res.writeHead(e.status, corsHeaders);
                    res.end();
                    return;
                }
            }
        }

        res.writeHead(200, {
            ...corsHeaders,
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive"
        });

        for await (const chunk of stream.iterator()) {
            if (!chunk || chunk.error) break;
            res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        }

        res.write("data: [DONE]\n\n");
        res.end();
    });
}).listen(6969, "127.0.0.1");