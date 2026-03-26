import { renderRss2 } from '../../utils/util';

const XIAOHONGSHU_BASE_URL = 'https://www.xiaohongshu.com';

let getCoverUrl = (cover) => {
	return cover?.infoList?.[0]?.url || cover?.info_list?.[0]?.url || cover?.urlPre || cover?.urlDefault || cover?.url || '';
};

let buildGuid = ({ uid, noteId, xsecToken, title, coverUrl }) => {
	return noteId || `${uid}:${title}:${coverUrl || xsecToken || 'xiaohongshu'}`;
};

let normalizeXiaohongshuUrl = (urlLike) => {
	const url = new URL(urlLike, XIAOHONGSHU_BASE_URL);
	url.pathname = url.pathname.replace(/\/+$/, '');
	return url.toString();
};

let buildNoteLink = ({ uid, noteId, xsecToken, rawLink, xsecSource = 'pc_user' }) => {
	if (rawLink) {
		return normalizeXiaohongshuUrl(rawLink.replace(/&amp;/g, '&'));
	}
	if (noteId) {
		if (xsecToken) {
			return `${XIAOHONGSHU_BASE_URL}/explore/${noteId}?xsec_token=${encodeURIComponent(xsecToken)}&xsec_source=${xsecSource}`;
		}
		return `${XIAOHONGSHU_BASE_URL}/explore/${noteId}`;
	}
	if (xsecToken) {
		return `${XIAOHONGSHU_BASE_URL}/user/profile/${uid}?xsec_token=${encodeURIComponent(xsecToken)}&xsec_source=${xsecSource}`;
	}
	return `${XIAOHONGSHU_BASE_URL}/user/profile/${uid}`;
};

let getUser = async (url, cookie = '') => {
	let res = await fetch(url, {
		headers: {
			"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
			...(cookie ? { Cookie: cookie } : {}),
		}
	});
	let scripts = [];
	let noteLinks = [];
	let rewriter = new HTMLRewriter()
		.on('script', {
			element(element) {
				scripts.push('');
			},
			text(text) {
				scripts[scripts.length - 1] += text.text;
			},
		})
		.on('a.cover.mask', {
			element(element) {
				const href = element.getAttribute('href');
				if (href) {
					noteLinks.push(href);
				}
			},
		})
		.transform(res);
	await rewriter.text();
	let script = scripts.find((script) => script.includes('window.__INITIAL_STATE__='));
	if (!script) {
		throw new Error('Failed to locate xiaohongshu initial state');
	}
	script = script.slice(script.indexOf('window.__INITIAL_STATE__=') + 'window.__INITIAL_STATE__='.length);
	// replace undefined to null
	script = script.replace(/undefined/g, 'null');
	let state = JSON.parse(script);
	return {
		...state.user,
		noteLinks,
	};
};

let deal = async (ctx) => {
	// const uid = ctx.params.user_id;
	// const category = ctx.params.category;
	const { uid } = ctx.req.param();
	const category = 'notes';
	const url = `https://www.xiaohongshu.com/user/profile/${uid}`;
	const cookie = ctx.env.XIAOHONGSHU_COOKIE || '';

	const {
		userPageData: { basicInfo, interactions, tags },
		notes,
		collect,
		noteLinks,
	} = await getUser(url, cookie);

	const title = `${basicInfo.nickname} - ${category === 'notes' ? '笔记' : '收藏'} • 小红书 / RED`;
	const description = `${basicInfo.desc} ${tags.map((t) => t.name).join(' ')} ${interactions.map((i) => `${i.count} ${i.name}`).join(' ')}`;
	const image = basicInfo.imageb || basicInfo.images;

	const renderNote = (notes) => {
		let noteIndex = 0;
		return notes.flatMap((n) =>
			n.map(({ id, noteCard }) => {
				const coverUrl = getCoverUrl(noteCard.cover);
				const rawLink = noteLinks[noteIndex++];
				return {
					title: noteCard.displayTitle,
					link: buildNoteLink({
						uid,
						rawLink,
						noteId: noteCard.noteId || id,
						xsecToken: noteCard.xsecToken,
					}),
					guid: buildGuid({
						uid,
						noteId: noteCard.noteId || id,
						xsecToken: noteCard.xsecToken,
						title: noteCard.displayTitle,
						coverUrl,
					}),
					description: `<img src ="${coverUrl}"><br>${noteCard.displayTitle}`,
					author: noteCard.user.nickname,
					upvotes: noteCard.interactInfo.likedCount,
				};
			})
		);
	};
	const renderCollect = (collect) => {
		if (!collect) {
			throw Error('该用户已设置收藏内容不可见');
		}
		if (collect.code !== 0) {
			throw Error(JSON.stringify(collect));
		}
		if (!collect.data.notes.length) {
			throw ctx.throw(403, '该用户已设置收藏内容不可见');
		}
		return collect.data.notes.map((item) => {
			const coverUrl = getCoverUrl(item.cover);
			return {
				title: item.display_title,
				link: buildNoteLink({
					uid,
					noteId: item.note_id,
					xsecToken: item.xsec_token || item.xsecToken,
				}),
				guid: buildGuid({
					uid,
					noteId: item.note_id,
					xsecToken: item.xsec_token || item.xsecToken,
					title: item.display_title,
					coverUrl,
				}),
				description: `<img src ="${coverUrl}"><br>${item.display_title}`,
				author: item.user.nickname,
				upvotes: item.interact_info.likedCount,
			};
		});
	};

	ctx.header('Content-Type', 'application/xml');
	return ctx.text(
		renderRss2({
			title,
			description,
			image,
			link: url,
			items: category === 'notes' ? renderNote(notes) : renderCollect(collect),
		})
	);
};

let setup = (route) => {
	route.get('/xiaohongshu/user/:uid', deal);
};

export default { setup };
