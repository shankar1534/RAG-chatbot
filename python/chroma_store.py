import argparse
import json
import sys
from pathlib import Path

import chromadb


ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / 'data'
DATA_DIR.mkdir(exist_ok=True)
COLLECTION_NAME = 'offline-documents'


def get_client():
    return chromadb.PersistentClient(path=str(DATA_DIR / 'chroma'))


def get_collection():
    client = get_client()
    return client.get_or_create_collection(name=COLLECTION_NAME, embedding_function=None)


def add_documents(chunks, source_name, file_path, embeddings=None):
    collection = get_collection()
    ids = []
    documents = []
    metadatas = []

    normalized_chunks = []
    if isinstance(chunks, list):
        for item in chunks:
            if isinstance(item, dict):
                normalized_chunks.append(item)
            elif isinstance(item, str):
                normalized_chunks.append({'text': item, 'pageNumber': 1})
    elif isinstance(chunks, str):
        normalized_chunks.append({'text': chunks, 'pageNumber': 1})

    for index, chunk in enumerate(normalized_chunks):
        chunk_id = f"{source_name}-{index}".replace(' ', '_')
        ids.append(chunk_id)
        documents.append(chunk.get('text', ''))
        metadatas.append({
            'sourceName': source_name,
            'filePath': file_path,
            'pageNumber': chunk.get('pageNumber', 1),
            'chunkIndex': index
        })

    try:
        if embeddings is not None:
            collection.add(
                documents=documents,
                metadatas=metadatas,
                ids=ids,
                embeddings=embeddings,
            )
        else:
            collection.add(
                documents=documents,
                metadatas=metadatas,
                ids=ids,
            )
    except Exception as exc:
        if 'dimension' in str(exc).lower() or 'embedding' in str(exc).lower():
            reset_collection()
            collection = get_collection()
            if embeddings is not None:
                collection.add(
                    documents=documents,
                    metadatas=metadatas,
                    ids=ids,
                    embeddings=embeddings,
                )
            else:
                collection.add(
                    documents=documents,
                    metadatas=metadatas,
                    ids=ids,
                )
        else:
            raise

    return len(ids)


def search_documents(query_embedding, top_k=4):
    collection = get_collection()
    if isinstance(query_embedding, list) and len(query_embedding) == 1 and isinstance(query_embedding[0], list):
        query_embedding = query_embedding[0]
    results = collection.query(
        query_embeddings=[query_embedding],
        n_results=top_k,
        include=['documents', 'metadatas', 'distances']
    )
    return results


def count_documents():
    collection = get_collection()
    return collection.count()


def reset_collection():
    import shutil

    client = get_client()
    try:
        client.delete_collection(name=COLLECTION_NAME)
    except Exception:
        pass

    chroma_dir = DATA_DIR / 'chroma'
    if chroma_dir.exists():
        shutil.rmtree(chroma_dir, ignore_errors=True)

    chroma_dir.mkdir(parents=True, exist_ok=True)
    return client.get_or_create_collection(name=COLLECTION_NAME, embedding_function=None)


def parse_json_value(raw_value, default):
    if not raw_value:
        return default
    if isinstance(raw_value, str):
        try:
            return json.loads(raw_value)
        except Exception:
            return raw_value
    return raw_value


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--action', required=True)
    parser.add_argument('--source-name')
    parser.add_argument('--file-path')
    parser.add_argument('--chunks')
    parser.add_argument('--embeddings')
    parser.add_argument('--embedding')
    parser.add_argument('--top-k', type=int, default=4)
    args = parser.parse_args()

    if args.action == 'add':
        chunks = parse_json_value(args.chunks, [])
        embeddings = parse_json_value(args.embeddings, [])
        print(add_documents(chunks, args.source_name or 'unknown', args.file_path or '', embeddings=embeddings))
    elif args.action == 'search':
        embedding = parse_json_value(args.embedding, [])
        results = search_documents(embedding, args.top_k)
        payload = {
            'results': []
        }
        for doc, meta, distance in zip(results.get('documents', [[]])[0], results.get('metadatas', [[]])[0], results.get('distances', [[]])[0]):
            payload['results'].append({
                'document': doc,
                'metadata': meta,
                'distance': distance
            })
        print(json.dumps(payload))
    elif args.action == 'count':
        print(count_documents())
    elif args.action == 'reset':
        reset_collection()
        print('reset')
    else:
        print('unknown-action')
        sys.exit(1)
