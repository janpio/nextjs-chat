import { kv } from '@vercel/kv'

import { auth } from '@/auth'
import { nanoid } from '@/lib/utils'

import { PrismaVectorStore } from "langchain/vectorstores/prisma";
import { PrismaClient, Prisma, Document } from "@prisma/client";
import { OpenAIEmbeddings } from "langchain/embeddings/openai";
import { ChatOpenAI } from "langchain/chat_models/openai";
import { ConversationalRetrievalQAChain } from 'langchain/chains'
import { LangChainStream, StreamingTextResponse, Message } from "ai";
import { BufferMemory } from "langchain/memory";

// export const runtime = 'edge'

export async function POST(req: Request) {
  const json = await req.json()
  const { messages, previewToken } = json
  const { stream, handlers } = LangChainStream({
    async onCompletion(completion) {
      const title = json.messages[0].content.substring(0, 100)
      const id = json.id ?? nanoid()
      const createdAt = Date.now()
      const path = `/chat/${id}`
      const payload = {
        id,
        title,
        userId,
        createdAt,
        path,
        messages: [
          ...messages,
          {
            content: completion,
            role: 'assistant'
          }
        ]
      }
      await kv.hmset(`chat:${id}`, payload)
      await kv.zadd(`user:chat:${userId}`, {
        score: createdAt,
        member: `chat:${id}`
      })
    }
  })

  const userId = (await auth())?.user.id

  if (!userId) {
    return new Response('Unauthorized', {
      status: 401
    })
  }

  const db = new PrismaClient();

  const vectorStore = PrismaVectorStore.withModel<Document>(db).create(
    new OpenAIEmbeddings(),
    {
      prisma: Prisma,
      tableName: "Document",
      vectorColumnName: "vector",
      columns: {
        id: PrismaVectorStore.IdColumn,
        content: PrismaVectorStore.ContentColumn,
      },
    }
  );

  const model = new ChatOpenAI({
    modelName: "gpt-3.5-turbo",
    temperature: 0.7,
    streaming: true,
  })

  const query = (messages as Message[]).map(m =>
    m.role == 'user'
      ? m.content
      : ""
  )?.at(-1);

  const chain = ConversationalRetrievalQAChain.fromLLM(
    model,
    vectorStore.asRetriever(),
    {
      memory: new BufferMemory({
        memoryKey: "chat_history",
      }),
    }
  );

  chain
    .call({ question: query },
      [handlers]
    )
    .catch(console.error)

  return new StreamingTextResponse(stream)
}
