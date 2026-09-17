import json
import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MINI = ROOT / "apps" / "miniprogram"


class ProjectFileTests(unittest.TestCase):
    def test_miniprogram_has_only_two_frozen_tabs(self):
        config = json.loads((MINI / "app.json").read_text(encoding="utf-8"))
        tabs = [(item["pagePath"], item["text"]) for item in config["tabBar"]["list"]]
        self.assertEqual(tabs, [("pages/index/index", "找比赛"), ("pages/my/my", "我的")])

    def test_required_vertical_slice_pages_exist(self):
        for stem in ("pages/index/index", "pages/detail/detail", "pages/feedback/feedback", "pages/favorites/favorites", "pages/reminders/reminders", "pages/my/my"):
            for suffix in (".ts", ".wxml", ".wxss", ".json"):
                self.assertTrue((MINI / f"{stem}{suffix}").exists(), f"missing {stem}{suffix}")

    def test_my_page_links_to_finished_favorites_feature(self):
        page = (MINI / "pages/my/my.wxml").read_text(encoding="utf-8")
        logic = (MINI / "pages/my/my.ts").read_text(encoding="utf-8")
        self.assertIn('bindtap="openFavorites"', page)
        self.assertIn("{{favoriteCount}} 场", page)
        self.assertNotIn("我的收藏<text>开发中", page)
        self.assertIn("getFavoriteRecords", logic)
        self.assertIn("/pages/favorites/favorites", logic)
        # 纠错入口从「弹窗提示去找比赛」改成了直接进纠错页：
        # 用户在那一页选赛事并填写理由，不必先绕回列表页。
        self.assertIn('bindtap="openFeedback"', page)
        self.assertIn("/pages/feedback/feedback", logic)
        self.assertTrue((MINI / "pages/feedback/feedback.wxml").exists())

    def test_reminder_feature_matches_prd_entry_points(self):
        detail_page = (MINI / "pages/detail/detail.wxml").read_text(encoding="utf-8")
        detail_logic = (MINI / "pages/detail/detail.ts").read_text(encoding="utf-8")
        my_page = (MINI / "pages/my/my.wxml").read_text(encoding="utf-8")
        reminders = (MINI / "services/reminders.ts").read_text(encoding="utf-8")
        self.assertIn("设置提醒", detail_page)
        self.assertIn("报名开始", detail_logic)
        self.assertIn("报名截止", detail_logic)
        for label in ("提前1天", "提前3天", "提前5天", "提前7天", "提前15天", "提前1个月", "提前3个月"):
            self.assertIn(label, reminders)
        self.assertIn('bindtap="openReminders"', my_page)
        self.assertNotIn("我的提醒<text>开发中", my_page)

    def test_reminder_replace_is_atomic_and_preserves_active_delivery(self):
        user_data = (MINI / "cloudfunctions/userData/index.js").read_text(encoding="utf-8")
        policy = (MINI / "cloudfunctions/userData/reminderWritePolicy.js").read_text(encoding="utf-8")
        self.assertIn("db.runTransaction", user_data)
        self.assertIn("shouldPreserveCloudReminder(current)", user_data)
        self.assertIn("delivery_status === 'queued'", policy)

    def test_wxml_has_no_javascript_method_calls(self):
        for path in MINI.rglob("*.wxml"):
            text = path.read_text(encoding="utf-8")
            self.assertNotRegex(text, r"\.(slice|map|filter|join|substring)\(", str(path))

    def test_selected_filter_area_supports_individual_and_full_clear(self):
        page = (MINI / "pages/index/index.wxml").read_text(encoding="utf-8")
        logic = (MINI / "pages/index/index.ts").read_text(encoding="utf-8")
        self.assertIn("已选条件", page)
        self.assertIn('bindtap="removeCondition"', page)
        self.assertIn('bindtap="clearFilters"', page)
        self.assertIn("selectedConditions", logic)

    def test_index_preview_banner_follows_repository_mode(self):
        page = (MINI / "pages/index/index.wxml").read_text(encoding="utf-8")
        logic = (MINI / "pages/index/index.ts").read_text(encoding="utf-8")
        self.assertIn('wx:if="{{preview}}" class="preview-banner"', page)
        self.assertIn("preview: result.preview", logic)

    def test_more_filter_sheet_and_combined_query_exist(self):
        page = (MINI / "pages/index/index.wxml").read_text(encoding="utf-8")
        logic = (MINI / "pages/index/index.ts").read_text(encoding="utf-8")
        repository = (MINI / "services/repository.ts").read_text(encoding="utf-8")
        self.assertIn("更多筛选", page)
        self.assertIn("查看{{morePreviewCount}}场赛事", page)
        for label in ("参赛形式", "队伍人数", "报名费用", "报名组织方式"):
            self.assertIn(label, page)
        for field in ("participationFormat", "teamSizeCategory", "feeType", "registrationOrganization"):
            self.assertIn(field, logic)
            self.assertIn(field, repository)
        self.assertIn("moreFilterLabel", logic)
        self.assertIn("pageSize: 8", logic)

    def test_admin_has_separate_more_filter_editor(self):
        admin = (ROOT / "apps/admin/src/App.tsx").read_text(encoding="utf-8")
        editor = (ROOT / "apps/admin/src/CompetitionEditor.tsx").read_text(encoding="utf-8")
        self.assertIn("编辑赛事全部内容", editor)
        self.assertIn("participationFormat", editor)
        self.assertIn("registrationOrganization", editor)
        for section in ("基本信息", "参赛与报名信息", "时间安排", "赛项信息", "推荐内容", "审核与发布状态", "数据来源"):
            self.assertIn(section, editor)
        self.assertIn("window.confirm", admin)
        self.assertIn("是否确定保存本次更改", admin)
        self.assertIn("persistAdminRecords", admin)
        self.assertIn("最近操作记录", admin)
        self.assertIn("发布和下架只能在“审核发布”模块执行", admin)
        self.assertIn("已进入公开缓存（只读）", editor)

    def test_admin_operation_modules_are_implemented(self):
        admin = (ROOT / "apps/admin/src/App.tsx").read_text(encoding="utf-8")
        modules = (ROOT / "apps/admin/src/OperationModules.tsx").read_text(encoding="utf-8")
        store = (ROOT / "apps/admin/src/operationsStore.ts").read_text(encoding="utf-8")
        for label in ("纠错审核", "AI失败任务", "操作记录"):
            self.assertIn(label, admin)
        for action in ("采纳并进入资料复核", "重试", "转人工", "导出 JSON"):
            self.assertIn(action, modules)
        self.assertIn("persistFeedbacks", modules)
        self.assertIn("persistAiJobs", modules)
        self.assertIn("开发环境未配置AI Provider", store)
        for label in ("待AI审核", "问题待人工审核", "AI通过抽查池", "抽查正确", "抽查有误"):
            self.assertIn(label, modules)
        self.assertIn("feedback_review", store)

    def test_wechat_login_and_user_data_binding_are_implemented(self):
        app = (MINI / "app.ts").read_text(encoding="utf-8")
        cloud_session = (MINI / "services/cloudSession.ts").read_text(encoding="utf-8")
        favorites = (MINI / "services/favorites.ts").read_text(encoding="utf-8")
        reminders = (MINI / "services/reminders.ts").read_text(encoding="utf-8")
        login_function = (MINI / "cloudfunctions/login/index.js").read_text(encoding="utf-8")
        user_data_function = (MINI / "cloudfunctions/userData/index.js").read_text(encoding="utf-8")
        self.assertNotIn("mock-user-001", app)
        self.assertIn("loginWithWechat", app)
        self.assertIn("wx.cloud.callFunction", cloud_session)
        self.assertIn("cloud.getWXContext", login_function)
        self.assertIn("cloud.getWXContext", user_data_function)
        self.assertIn("initializeFavoritesCloudSync", favorites)
        self.assertIn("initializeRemindersCloudSync", reminders)
        self.assertIn("setFavorite", favorites)
        self.assertIn("replaceReminderEvent", reminders)

    def test_feedback_submission_reaches_cloud_review_queue(self):
        detail = (MINI / "pages/detail/detail.ts").read_text(encoding="utf-8")
        form = (MINI / "pages/feedback/feedback.ts").read_text(encoding="utf-8")
        user_data = (MINI / "cloudfunctions/userData/index.js").read_text(encoding="utf-8")
        admin_data = (MINI / "cloudfunctions/adminData/index.js").read_text(encoding="utf-8")
        self.assertIn("/pages/feedback/feedback", detail)
        self.assertIn("submitFeedback", form)
        self.assertIn("decodeURIComponent", form)
        self.assertIn("pending_ai_review", user_data)
        self.assertIn("loadSubmittedFeedbacks", admin_data)
        self.assertNotIn("纠错表单将在下一纵向切片接入", detail)

    def test_frontend_sources_contain_no_secret_values(self):
        forbidden = re.compile(r"(?:sk-[A-Za-z0-9_-]{12,}|APP_SECRET\s*=\s*[^\s]+|AI_API_KEY\s*=\s*[^\s]+)")
        for base in (ROOT / "apps" / "miniprogram", ROOT / "apps" / "admin" / "src"):
            for path in base.rglob("*"):
                if path.is_file() and path.suffix in {".ts", ".tsx", ".js", ".json", ".wxml"}:
                    self.assertIsNone(forbidden.search(path.read_text(encoding="utf-8")), str(path))

    def test_cloud_function_security_rules_keep_timer_internal(self):
        rules = json.loads((ROOT / "database/function-security-rules.json").read_text(encoding="utf-8"))
        self.assertFalse(rules["*"]["invoke"])
        self.assertFalse(rules["sendReminders"]["invoke"])
        for function_name in ("login", "userData", "adminData"):
            self.assertEqual(rules[function_name]["invoke"], "auth != null")
        self.assertTrue(rules["publicData"]["invoke"])


if __name__ == "__main__":
    unittest.main()
