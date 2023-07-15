import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import { GithubRepoLoader } from "langchain/document_loaders/web/github";
import { OpenAIEmbeddings } from 'langchain/embeddings/openai';
import { PrismaVectorStore } from "langchain/vectorstores/prisma";
import { PrismaClient, Prisma, Document } from "@prisma/client";

export const run = async () => {
    try {

        // load the markdown files of the algorithm repo by twitter
        const loader = new GithubRepoLoader(
            "https://github.com/d3/d3",
            { branch: "main", recursive: true, unknown: "warn" }
        );
        const rawDocs = await loader.load();

        /* Split text into chunks */
        const textSplitter = new RecursiveCharacterTextSplitter({
            chunkSize: 1000,
            chunkOverlap: 200,
        });

        const docs = await textSplitter.splitDocuments(rawDocs);
        console.log('split docs', docs);

        console.log('creating vector store...');
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

        await vectorStore.addModels(
            await db.$transaction(
                docs.map((doc) => db.document.create({ data: { content: doc.pageContent } }))
            )
        );
    } catch (error) {
        console.log('error', error);
        throw new Error('Failed to ingest your data');
    }
};

(async () => {
    await run();
    console.log('ingestion complete');
})();