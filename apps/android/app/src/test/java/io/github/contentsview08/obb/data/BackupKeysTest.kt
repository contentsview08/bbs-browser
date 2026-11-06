package io.github.contentsview08.obb.data

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class BackupKeysTest {
    @Test fun secrets_are_not_in_backup() {
        for (k in listOf("honoUser", "honoPassword", "imgbbApiKey", "imgurClientId", "lastBoardUrl", "lastBoardName")) assertFalse(k, Prefs.inBackup(k))
    }

    @Test fun ordinary_settings_are_in_backup() {
        for (k in listOf("keywords", "gesturesEnabled", "uploadHost", "postName")) assertTrue(k, Prefs.inBackup(k))
    }
}
