import type { Archive } from '../../src/lib/schema'

// Keep behavior tests independent of records and settings edited through the site.
export const archiveFixture: Archive = {
  version: 1,
  settings: {
    name: '余响',
    englishName: 'AFTERGLOW',
    owner: '测试观众',
    tagline: '记录现场',
    bio: '测试用观演档案'
  },
  records: [
    {
      id: 'test-concert',
      title: '交响音乐会',
      artist: '测试乐团',
      date: '2025-06-21',
      city: '上海',
      venue: '测试音乐厅',
      type: '音乐会',
      rating: 5,
      note: '中文观演记录',
      tags: ['交响乐'],
      program: ['测试序曲'],
      images: ['photos/orchestra.jpg'],
      featured: true,
      published: true,
      demo: false
    },
    {
      id: 'test-livehouse',
      title: '小场地现场',
      artist: '测试乐队',
      date: '2025-04-12',
      city: '南京',
      venue: '测试 Livehouse',
      type: 'Livehouse',
      rating: 4,
      note: '',
      tags: [],
      program: [],
      images: [],
      featured: false,
      published: true,
      demo: false
    }
  ]
}
