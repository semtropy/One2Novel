/**
 * NovelRedirect — 根据 projectStatus 自动跳转到规划中心或写作台
 */
import { useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "../app/api";
import { Loading } from "../components/common/Loading";

export function NovelRedirect() {
  const { novelId } = useParams<{ novelId: string }>();
  const navigate = useNavigate();

  useEffect(() => {
    if (!novelId) return;
    api.get(`/novels/${novelId}`).then(({ data }) => {
      const status = data.data?.projectStatus;
      if (status === "not_started") {
        navigate(`/novels/${novelId}/plan`, { replace: true });
      } else {
        navigate(`/novels/${novelId}/write`, { replace: true });
      }
    }).catch(() => {
      navigate("/novels", { replace: true });
    });
  }, [novelId, navigate]);

  return <Loading text="加载中..." />;
}
