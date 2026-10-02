import { fetchInitialSession } from '~/services/session';
import { fetchPlatformClubs, managePlatformClub } from '~/services/platform';

Page({
  data: { allowed: false, loading: true, busy: false, error: '', clubs: [], id: '', name: '', description: '', discoverable: false, publishing: false, uploads: false, moderatorUserId: '', reason: '', selected: null },
  onShow() { this.load(); },
  async load() {
    this.setData({ loading: true, error: '', allowed: false, clubs: [] });
    try {
      const session = await fetchInitialSession();
      if (session.platformRole !== 'developer') { this.setData({ error: '此页面仅供开发者管理社团' }); return; }
      const result = await fetchPlatformClubs();
      this.setData({ allowed: true, clubs: result.list || [] });
    } catch (error) { this.setData({ error: error.message || '读取失败，请重试' }); }
    finally { this.setData({ loading: false }); }
  },
  onInput(event) {
    const { field } = event.currentTarget.dataset;
    if (['id', 'name', 'description', 'moderatorUserId', 'reason'].includes(field)) this.setData({ [field]: event.detail.value });
  },
  onSwitch(event) {
    const { field } = event.currentTarget.dataset;
    if (['discoverable', 'publishing', 'uploads'].includes(field)) this.setData({ [field]: event.detail.value });
  },
  onSelect(event) {
    const selected = this.data.clubs.find((club) => club.id === event.currentTarget.dataset.id);
    if (selected) this.setData({ selected, id: selected.id, name: selected.name || '', description: selected.description || '', discoverable: selected.discoverable, publishing: selected.publishing, uploads: selected.uploads, moderatorUserId: '', reason: '' });
  },
  onNew() { this.setData({ selected: null, id: '', name: '', description: '', discoverable: false, publishing: false, uploads: false, moderatorUserId: '', reason: '' }); },
  async onAction(event) {
    if (this.data.busy || !this.data.allowed) return;
    const { action } = event.currentTarget.dataset;
    const { selected, id, name, description, discoverable, publishing, uploads, moderatorUserId, reason } = this.data;
    if (reason.trim().length < 10) { wx.showToast({ title: '请填写至少10字的操作理由', icon: 'none' }); return; }
    const payload = { id, reason, expectedVersion: selected ? selected.version : 0 };
    if (action === 'create' || action === 'update') payload.config = { name, description, discoverable, publishing, uploads };
    if (action === 'create' || action === 'moderator') payload.moderatorUserId = moderatorUserId;
    if (action === 'status') payload.status = selected.status === 'active' ? 'paused' : 'active';
    let impact = '保存社团配置';
    if (action === 'status') impact = payload.status === 'paused' ? '暂停后社团读写与成员访问将停止' : '恢复成员访问';
    if (action === 'moderator' || action === 'create') impact = '授予指定账号本社负责人权限，原有管理成员保留权限';
    const confirmation = await new Promise((resolve) => {
      wx.showModal({ title: '确认社团管理操作', content: `${id}：${impact}。操作将记录审计。`, success: resolve, fail: () => resolve({ confirm: false }) });
    });
    if (!confirmation.confirm) return;
    this.setData({ busy: true, error: '' });
    try {
      await managePlatformClub(action, payload);
      this.onNew();
      await this.load();
      wx.showToast({ title: '已完成', icon: 'success' });
    } catch (error) { this.setData({ error: error.message || '操作失败，请刷新后重试' }); }
    finally { this.setData({ busy: false }); }
  },
});
