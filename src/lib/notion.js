import { Client } from '@notionhq/client';

const notion = new Client({ auth: import.meta.env.NOTION_TOKEN });
const DATABASE_ID = import.meta.env.NOTION_DATABASE_ID;

export async function getPublishedItems() {
  const response = await notion.databases.query({
    database_id: DATABASE_ID,
    filter: {
      property: 'Status',
      select: { equals: 'Published' },
    },
    sorts: [
      {
        property: 'Published Date',
        direction: 'descending',
      },
    ],
  });

  return response.results.map((page) => {
    const props = page.properties;
    return {
      id: page.id,
      title: props['Title']?.title?.[0]?.plain_text ?? '',
      pillar: props['Pillar']?.select?.name ?? '',
      platform: props['Platform']?.select?.name ?? '',
      tags: props['Tags']?.multi_select?.map((t) => t.name) ?? [],
      sourceUrl: props['Source URL']?.url ?? '',
      imageUrl: props['Image URL']?.url ?? '',
      curationNote: props['Curation Note']?.rich_text?.[0]?.plain_text ?? '',
      publishedDate: props['Published Date']?.date?.start ?? '',
    };
  });
}

export function getPillars(items) {
  return [...new Set(items.map((i) => i.pillar).filter(Boolean))];
}

export function getPlatforms(items) {
  return [...new Set(items.map((i) => i.platform).filter(Boolean))];
}

export function getAllTags(items) {
  return [...new Set(items.flatMap((i) => i.tags))];
}
