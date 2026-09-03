import { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native'
import { router } from 'expo-router'

import { clearRememberedLogin, getRememberedLogin, saveLoginSession, saveRememberedLogin } from '@/lib/auth/storage'
import { api } from '@/lib/api/client'

const brandImage = require('../public/image/thefull_logo.png')


type LoginResponse = {
  code?: string | number
  msg?: string
  use_yn?: string | null
  position_name?: string | null
  user_name?: string | null
  user_id?: string | null
  user_type?: string | number | null
  position?: string | number | null
  department?: string | number | null
  account_id?: string | number | null
}

export default function LoginScreen() {
  const { width } = useWindowDimensions()
  const isCompact = width < 390
  const isTablet = width >= 768

  const [userId, setUserId] = useState('')
  const [password, setPassword] = useState('')
  const [rememberMe, setRememberMe] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isHydrating, setIsHydrating] = useState(true)

  const performLogin = useCallback(async (id: string, pw: string) => {
    if (!id || !pw) {
      Alert.alert('알림', 'ID와 PASSWORD를 입력해 주세요.')
      return
    }

    try {
      setIsSubmitting(true)

      const response = await api.post<LoginResponse>('/User/Login', {
        userId: id,
        password: pw,
      })

      const responseCode = String(response.code ?? '')

      if (responseCode === '400') {
        Alert.alert('실패', response.msg || '로그인에 실패했습니다.')
        return
      }

      if (responseCode === '403') {
        const useYn = String(response.use_yn ?? '').toUpperCase()

        if (useYn === 'N') {
          Alert.alert('승인 대기', '승인 요청 중입니다.\n관리자에게 문의해주세요.')
        } else {
          Alert.alert('로그인 불가', response.msg || '로그인할 수 없습니다.')
        }
        return
      }

      if (rememberMe) {
        await saveRememberedLogin(id, pw)
      } else {
        await clearRememberedLogin()
      }

      await saveLoginSession(response)

      const department = String(response.department ?? '')

      if (department === '7') {
        router.replace('/home')
        return
      }

      router.replace('/home')
    } catch (error) {
      const message =
        error instanceof Error ? error.message : '서버 통신 중 오류가 발생했습니다.'
      Alert.alert('통신 오류', message)
    } finally {
      setIsSubmitting(false)
    }
  }, [rememberMe])

  const handleLogin = async (id = userId, pw = password) => {
    await performLogin(id.trim(), pw)
  }

  useEffect(() => {
    let active = true

    const hydrateLogin = async () => {
      try {
        const savedLogin = await getRememberedLogin()

        if (!active) {
          return
        }

        setRememberMe(savedLogin.autoLoginEnabled)
        setUserId(savedLogin.userId)
        setPassword(savedLogin.password)

        if (savedLogin.autoLoginEnabled && savedLogin.userId && savedLogin.password) {
          await performLogin(savedLogin.userId, savedLogin.password)
        }
      } finally {
        if (active) {
          setIsHydrating(false)
        }
      }
    }

    void hydrateLogin()

    return () => {
      active = false
    }
  }, [performLogin])

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          isTablet && styles.contentTablet,
          isCompact && styles.contentCompact,
        ]}
      >
        <View style={[styles.formCard, isTablet && styles.formCardTablet]}>
          <Image source={brandImage} style={styles.brandImage} resizeMode="contain" />
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>아이디</Text>
            <TextInput
              value={userId}
              onChangeText={setUserId}
              placeholder="아이디를 입력하세요"
              placeholderTextColor="#8a938f"
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.input}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>비밀번호</Text>
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder="비밀번호를 입력하세요"
              placeholderTextColor="#8a938f"
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.input}
            />
          </View>

          <Pressable style={styles.rememberRow} onPress={() => setRememberMe((current) => !current)}>
            <View style={[styles.checkbox, rememberMe && styles.checkboxChecked]}>
              {rememberMe ? <Text style={styles.checkboxMark}>✓</Text> : null}
            </View>
            <Text style={styles.rememberText}>자동 로그인</Text>
          </Pressable>

          <Pressable
            disabled={isSubmitting || isHydrating}
            style={[styles.loginButton, (isSubmitting || isHydrating) && styles.loginButtonDisabled]}
            onPress={() => void handleLogin()}
          >
            {isSubmitting || isHydrating ? (
              <View style={styles.loadingInline}>
                <ActivityIndicator color="#1d2e26" />
                <Text style={styles.loginButtonText}>
                  {isHydrating ? '저장된 로그인 확인 중' : '로그인 처리 중'}
                </Text>
              </View>
            ) : (
              <Text style={styles.loginButtonText}>로그인</Text>
            )}
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f4efe6',
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 24,
    gap: 18,
  },
  contentCompact: {
    paddingHorizontal: 16,
    paddingVertical: 18,
  },
  contentTablet: {
    alignSelf: 'center',
    width: '100%',
    maxWidth: 860,
    paddingVertical: 40,
  },
  formCard: {
    borderRadius: 28,
    padding: 22,
    backgroundColor: '#fffdf8',
    borderWidth: 1,
    borderColor: '#e1d7c6',
    gap: 16,
  },
  formCardTablet: {
    padding: 10,
  },
  formTitle: {
    color: '#15392d',
    fontSize: 26,
    fontWeight: '800',
  },
  brandImage: {
    width: '100%',
    height: 50,
    alignSelf: 'center',
  },
  inputGroup: {
    gap: 8,
  },
  inputLabel: {
    color: '#15392d',
    fontSize: 14,
    fontWeight: '700',
  },
  input: {
    minHeight: 54,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#d9d2c2',
    paddingHorizontal: 16,
    backgroundColor: '#f8f4ec',
    color: '#15392d',
    fontSize: 15,
  },
  rememberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: '#c0b39b',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fffdf8',
  },
  checkboxChecked: {
    backgroundColor: '#15392d',
    borderColor: '#15392d',
  },
  checkboxMark: {
    color: '#fffdf8',
    fontSize: 13,
    fontWeight: '800',
  },
  rememberText: {
    color: '#15392d',
    fontSize: 14,
    fontWeight: '700',
  },
  loginButton: {
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
    backgroundColor: '#c69b38',
  },
  loginButtonDisabled: {
    opacity: 0.7,
  },
  loadingInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  loginButtonText: {
    color: '#1d2e26',
    fontSize: 16,
    fontWeight: '800',
  },
  helperText: {
    color: '#6a756f',
    fontSize: 13,
    lineHeight: 20,
  },
})
