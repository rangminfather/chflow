import { supabase } from "@/lib/supabase";

export interface DeptClassOption {
  classNo: string;
  label: string;
  teacherName: string | null;
}

export interface DeptClassScope {
  isMaster: boolean;
  teacherId: string | null;
  ownClassNos: string[];
  classes: DeptClassOption[];
}

type DeptInfoRow = { is_admin?: boolean };
type ClassRow = {
  class_no: string;
  label: string | null;
  teacher_name: string | null;
};

/**
 * 일반 교사는 본인 담임 반, 시스템 관리자는 부서 전체 반을 사용한다.
 * 시스템 관리자 판정은 DB의 get_user_grade 우선 정책과 동일하게
 * get_department_info.is_admin(admin/office/pastor)을 단일 기준으로 삼는다.
 */
export async function fetchDeptClassScope(deptId: string, userId: string): Promise<DeptClassScope> {
  const [teacherResp, ownClassesResp, deptResp] = await Promise.all([
    supabase
      .from("edu_teachers")
      .select("id")
      .eq("department_id", deptId)
      .eq("user_id", userId)
      .eq("is_active", true)
      .maybeSingle(),
    supabase.rpc("edu_list_my_homeroom_classes", { p_dept_id: deptId }),
    supabase.rpc("get_department_info", { p_dept_id: deptId }),
  ]);

  const ownClassNos = Array.from(new Set(
    ((ownClassesResp.data || []) as { class_no: string }[])
      .map((row) => row.class_no?.trim())
      .filter((classNo): classNo is string => Boolean(classNo)),
  ));
  const isMaster = Boolean((deptResp.data?.[0] as DeptInfoRow | undefined)?.is_admin);

  if (!isMaster) {
    return {
      isMaster: false,
      teacherId: teacherResp.data?.id || null,
      ownClassNos,
      classes: ownClassNos.map((classNo) => ({ classNo, label: classNo, teacherName: null })),
    };
  }

  const { data } = await supabase.rpc("list_dept_classes_full", { p_dept_id: deptId });
  const seen = new Set<string>();
  const classes = ((data || []) as ClassRow[]).flatMap((row) => {
    const classNo = row.class_no?.trim();
    if (!classNo || seen.has(classNo)) return [];
    seen.add(classNo);
    return [{
      classNo,
      label: row.label?.trim() || classNo,
      teacherName: row.teacher_name?.trim() || null,
    }];
  });

  return {
    isMaster: true,
    teacherId: teacherResp.data?.id || null,
    ownClassNos,
    classes,
  };
}
