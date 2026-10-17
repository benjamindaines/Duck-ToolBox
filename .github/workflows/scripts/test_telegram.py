import contextlib
import io
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from telegram import build_caption


class CaptionTests(unittest.TestCase):
    def caption(self, **environment: str) -> str:
        with tempfile.TemporaryDirectory() as directory:
            artifact = Path(directory) / "module.zip"
            artifact.touch()
            output = io.StringIO()
            with patch.dict(os.environ, environment, clear=True):
                with contextlib.redirect_stdout(output):
                    build_caption(str(artifact))
            return output.getvalue()

    def test_push_keeps_commit_metadata_and_marks_nightly(self):
        with patch("telegram.subprocess.check_output") as git:
            caption = self.caption(
                COMMIT_MESSAGE="Fix module\n\nCorrect its configuration.",
                COMMIT_AUTHOR="Contributor",
                GIT_BRANCH="main",
                GIT_SHA="12345678abcdef",
                MODULE_VERSION="0.1.2-stable (58-canary)",
            )
        git.assert_not_called()
        self.assertIn("Channel: <b>nightly</b>", caption)
        self.assertIn("Version: <b>0.1.2-stable (58-canary)</b>", caption)
        self.assertIn("Correct its configuration.", caption)
        self.assertIn("Author: <b>Contributor</b>", caption)

    def test_manual_stable_reads_metadata_from_the_built_commit(self):
        with patch(
            "telegram.subprocess.check_output",
            return_value="Release module\n\nStable build.\0Contributor\n",
        ) as git:
            caption = self.caption(
                RELEASE_CHANNEL="stable",
                MODULE_VERSION="0.1.2-stable",
                GIT_SHA="12345678abcdef",
            )
        git.assert_called_once_with(
            ["git", "show", "-s", "--format=%B%x00%an", "12345678abcdef"],
            text=True,
        )
        self.assertIn("Channel: <b>stable</b>", caption)
        self.assertIn("Version: <b>0.1.2-stable</b>", caption)
        self.assertIn("Release module", caption)
        self.assertIn("Author: <b>Contributor</b>", caption)

    def test_header_is_escaped_and_survives_caption_truncation(self):
        caption = self.caption(
            RELEASE_CHANNEL="stable",
            MODULE_VERSION="0.1.2<&>",
            COMMIT_MESSAGE="x" * 2000 + "\n\n" + "y" * 2000,
            COMMIT_AUTHOR="Contributor",
        )
        self.assertLessEqual(len(caption), 1024)
        self.assertIn("Channel: <b>stable</b>", caption)
        self.assertIn("Version: <b>0.1.2&lt;&amp;&gt;</b>", caption)


if __name__ == "__main__":
    unittest.main()
